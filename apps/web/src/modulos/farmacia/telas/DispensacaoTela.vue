<script setup lang="ts">
// Fila de dispensação por horário (ficha do M29, seção 7; regras 1 a 4): `/farmacia/dispensacao`. A unidade e a
// janela (parâmetro por unidade), os pacientes pelo leito e os horários com as doses; a dose bloqueada pela política
// mostra o motivo; o item rastreável escolhe entre os lotes com saldo do local (validade primeiro); o local e o centro
// vêm da lista (os locais de estoque e os centros com integração); filtros por paciente e faixa de horário e a leitura
// da dose (o código do horário ou do item) marcam a dose; ao dispensar, as etiquetas de dose vão à impressora (ou a tela
// oferece o arquivo). Tempo real: a fila relê na prescrição nova, na suspensão e na dispensação em outro terminal.
import type { DoseFila, LoteFarmacia, PacienteFila, ResultadoFarmacia } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  CANAL_FARMACIA,
  dispensar,
  lerApoio,
  lerFila,
  lerLotes,
  lerUnidades,
  novaChave,
} from '../api-farmacia.js';
import type { LeituraCodigo as Leitura } from '../../suprimentos/api-etiqueta.js';
import LeituraCodigo from '../../suprimentos/componentes/LeituraCodigo.vue';
import { mensagensEtiqueta as ME } from '../../suprimentos/i18n-etiqueta.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario, numero, qtd, usarAvisosFarmacia, usarFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const { pode, motivo } = usarFarmacia();
const unidades = useQuery({ queryKey: ['farmacia', 'unidades'], queryFn: () => lerUnidades() });
const unidade = ref('');
watch(
  () => unidades.data.value,
  (u) => {
    if (!unidade.value && u?.[0]) unidade.value = u[0].unidade;
  },
  { immediate: true },
);
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('farmacia.escolha') },
  ...(unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
]);
const fila = useQuery({
  queryKey: computed(() => ['farmacia', 'fila', unidade.value]),
  queryFn: () => lerFila(unidade.value),
  enabled: computed(() => !!unidade.value),
});
const { conectado } = usarAvisosFarmacia(CANAL_FARMACIA, () => void fila.refetch());
const apoio = useQuery({ queryKey: ['farmacia', 'apoio'], queryFn: () => lerApoio() });
const local = ref('');
const centro = ref('');
watch(
  () => apoio.data.value,
  (a) => {
    if (!a) return;
    if (!local.value && a.locais[0])
      local.value = String((a.locais.find((l) => l.codigo === 10) ?? a.locais[0]).codigo);
    if (!centro.value && a.centros[0]) centro.value = String(a.centros[0].codigo);
  },
  { immediate: true },
);
const opcoesLocal = computed(() => [
  { valor: '', rotulo: t('farmacia.escolha') },
  ...(apoio.data.value?.locais ?? []).map((l) => ({
    valor: String(l.codigo),
    rotulo: `${l.nome} (${l.codigo})`,
  })),
]);
const opcoesCentro = computed(() => [
  { valor: '', rotulo: t('farmacia.escolha') },
  ...(apoio.data.value?.centros ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.nome} (${c.codigo})`,
  })),
]);
const marcadas = ref<Record<number, boolean>>({});
const lotes = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const resultado = ref<ResultadoFarmacia | null>(null);

// Os lotes com saldo de cada item rastreável da fila, no local escolhido.
const lotesDoItem = ref<Record<number, LoteFarmacia[]>>({});
watch(
  () => [fila.data.value, local.value] as const,
  async ([f, l]) => {
    lotesDoItem.value = {};
    if (!f || !l) return;
    const itens = [
      ...new Set(
        f.pacientes.flatMap((p) =>
          dosesDe(p)
            .filter((d) => d.rastreavel)
            .map((d) => d.item),
        ),
      ),
    ];
    const r: Record<number, LoteFarmacia[]> = {};
    await Promise.all(
      itens.map(async (i) => {
        r[i] = await lerLotes(i, Number(l)).catch(() => []);
      }),
    );
    lotesDoItem.value = r;
  },
  { immediate: true },
);
function opcoesLote(d: DoseFila) {
  return [
    { valor: '', rotulo: t('farmacia.dispensacao.escolhaLote') },
    ...(lotesDoItem.value[d.item] ?? []).map((x) => ({
      valor: String(x.id),
      rotulo: t('farmacia.dispensacao.loteOpcao', {
        lote: x.lote,
        validade: x.validade,
        saldo: qtd(x.quantidade),
      }),
    })),
  ];
}

// Filtros por paciente e faixa de horário (HH:MM) e a leitura da dose.
const filtroPaciente = ref('');
const horaInicio = ref('');
const horaFim = ref('');
const leitura = ref('');
const leituraMsg = ref<string | null>(null);
const hhmm = (iso: string) => iso.slice(11, 16);
// A leitura do código da embalagem ou da etiqueta (F3.6, 05-SUP linha 14), presa ao paciente: cada paciente tem o
// próprio campo de leitura, e a leitura marca a próxima dose do item ainda não marcada DESTE paciente. A dose do
// mesmo item de outro paciente nunca é marcada (a leitura é recusada com o aviso); a etiqueta lida fica guardada na
// dose e é consumida na mesma transação da dispensação (a mesma etiqueta não serve a duas doses). O lote vencido ou
// bloqueado aparece como alerta e não é escolhido.
const etiquetasDose = ref<Record<number, string[]>>({});
const leituraPaciente = ref<{ atendimento: number; texto: string } | null>(null);
function lido(p: PacienteFila, r: Leitura): void {
  const avisar = (texto: string) => (leituraPaciente.value = { atendimento: p.atendimento, texto });
  const id = r.identificador?.toUpperCase() ?? null;
  if (id && Object.values(etiquetasDose.value).some((ls) => ls.includes(id)))
    return avisar(ME.etiquetaJaLida);
  const livre = (x: DoseFila) => x.item === r.item.codigo && !x.bloqueio && !marcadas.value[x.horario];
  const d = dosesDe(p).find(livre);
  if (!d) {
    const deOutro = pacientes.value.some((o) => o.atendimento !== p.atendimento && dosesDe(o).some(livre));
    return avisar(deOutro ? ME.doseDeOutroPaciente : ME.semDoseDoItem);
  }
  marcadas.value = { ...marcadas.value, [d.horario]: true };
  if (id) etiquetasDose.value = { ...etiquetasDose.value, [d.horario]: [id] };
  const bloqueado = r.alertas.includes('vencido') || r.alertas.includes('lote-bloqueado');
  const l = (lotesDoItem.value[d.item] ?? []).find((x) => (x as { lote?: string }).lote === r.lote);
  if (l && !bloqueado) lotes.value = { ...lotes.value, [d.horario]: String(l.id) };
  avisar(`${ME.lido}: ${d.descricao}${id ? ` · ${id}` : ''}`);
}
const pacientes = computed(() => {
  const f = filtroPaciente.value.trim().toUpperCase();
  return (fila.data.value?.pacientes ?? [])
    .filter(
      (p) =>
        !f ||
        p.leito.toUpperCase().includes(f) ||
        p.iniciais.toUpperCase().includes(f) ||
        String(p.atendimento).includes(f),
    )
    .map((p) => ({
      ...p,
      horarios: p.horarios.filter(
        (h) =>
          (!horaInicio.value || hhmm(h.previsto) >= horaInicio.value) &&
          (!horaFim.value || hhmm(h.previsto) <= horaFim.value),
      ),
    }))
    .filter((p) => p.horarios.length > 0);
});
function lerDose(): void {
  const lido = leitura.value.trim();
  leituraMsg.value = null;
  if (!lido) return;
  // O código do horário é da dose (um paciente só); o código do item vai ao campo de leitura do paciente, que não
  // marca dose de outro paciente.
  for (const p of fila.data.value?.pacientes ?? [])
    for (const d of dosesDe(p))
      if (!d.bloqueio && String(d.horario) === lido) {
        marcadas.value[d.horario] = true;
        leituraMsg.value = t('farmacia.dispensacao.leituraAchou', { item: d.descricao });
        leitura.value = '';
        return;
      }
  leituraMsg.value = t('farmacia.dispensacao.leituraNaoAchou');
}

function dosesDe(p: PacienteFila): DoseFila[] {
  return p.horarios.flatMap((h) => h.doses);
}
function marcarTodas(p: PacienteFila): void {
  for (const d of dosesDe(p)) if (!d.bloqueio) marcadas.value[d.horario] = true;
}
async function dispensarDo(p: PacienteFila): Promise<void> {
  erro.value = null;
  aviso.value = null;
  resultado.value = null;
  const doses = dosesDe(p).filter((d) => marcadas.value[d.horario]);
  const loteDe = (d: DoseFila) =>
    (lotesDoItem.value[d.item] ?? []).find((x) => String(x.id) === lotes.value[d.horario]);
  if (doses.some((d) => d.rastreavel && !loteDe(d))) {
    aviso.value = t('farmacia.dispensacao.loteObrigatorio');
    return;
  }
  try {
    const r = await dispensar(
      {
        atendimento: p.atendimento,
        local: Number(local.value),
        centroCusto: Number(centro.value),
        doses: doses.map((d) => {
          const q = d.quantidade ?? 1;
          const l = d.rastreavel ? loteDe(d) : undefined;
          const etq = etiquetasDose.value[d.horario] ?? [];
          // A etiqueta lida da dose vai na mesma operação: consumida com o movimento da dispensação.
          const comEtiquetas = etq.length ? { etiquetas: etq } : {};
          return l
            ? {
                horario: d.horario,
                quantidade: q,
                lotes: [{ lote: l.lote, validade: l.validade, quantidade: q }],
                ...comEtiquetas,
              }
            : {
                horario: d.horario,
                ...(d.quantidade ? { quantidade: numero(d.quantidade) } : {}),
                ...comEtiquetas,
              };
        }),
      },
      novaChave('dispensar'),
    );
    resultado.value = r;
    for (const d of doses) {
      delete marcadas.value[d.horario];
      delete etiquetasDose.value[d.horario];
    }
    leituraPaciente.value = null;
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
const urlEtiquetas = computed(() => {
  const z = resultado.value?.etiquetas?.zpl ?? [];
  return z.length ? `data:text/plain;charset=utf-8,${encodeURIComponent(z.join(''))}` : null;
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="disp-titulo" data-testid="tela-farmacia-dispensacao">
    <h1 id="disp-titulo">{{ t('farmacia.dispensacao.titulo') }}</h1>
    <p>{{ t('farmacia.dispensacao.texto') }}</p>
    <p class="atalhos">
      <RouterLink to="/farmacia/devolucoes">{{ t('farmacia.dispensacao.devolucoes') }}</RouterLink>
      ·
      <RouterLink to="/farmacia/parametros">{{ t('farmacia.dispensacao.parametros') }}</RouterLink>
    </p>
    <AvisoFarmacia
      :motivo="pode('suprimentos.dispensarHorario') ? null : motivo('suprimentos.dispensarHorario')"
    />
    <div class="filtros">
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('farmacia.unidade')"
        :opcoes="opcoesUnidade"
        data-testid="disp-unidade"
      />
      <SanteSelecao
        v-model="local"
        :rotulo="t('farmacia.dispensacao.local')"
        :opcoes="opcoesLocal"
        data-testid="disp-local"
      />
      <SanteSelecao
        v-model="centro"
        :rotulo="t('farmacia.dispensacao.centro')"
        :opcoes="opcoesCentro"
        data-testid="disp-centro"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('farmacia.atualizar')"
        @acionar="() => void fila.refetch()"
      />
    </div>
    <div class="filtros">
      <span class="campo">
        <label for="disp-filtro-paciente">{{ t('farmacia.dispensacao.paciente') }}</label>
        <input
          id="disp-filtro-paciente"
          v-model="filtroPaciente"
          autocomplete="off"
          data-testid="disp-filtro-paciente"
        />
      </span>
      <span class="campo">
        <label for="disp-hora-inicio">{{ t('farmacia.dispensacao.horaInicio') }}</label>
        <input id="disp-hora-inicio" v-model="horaInicio" type="time" data-testid="disp-hora-inicio" />
      </span>
      <span class="campo">
        <label for="disp-hora-fim">{{ t('farmacia.dispensacao.horaFim') }}</label>
        <input id="disp-hora-fim" v-model="horaFim" type="time" data-testid="disp-hora-fim" />
      </span>
      <span class="campo">
        <label for="disp-leitura">{{ t('farmacia.dispensacao.leitura') }}</label>
        <input
          id="disp-leitura"
          v-model="leitura"
          autocomplete="off"
          data-testid="disp-leitura"
          @keydown.enter.prevent="lerDose()"
        />
      </span>
    </div>
    <p v-if="leituraMsg" role="status" data-testid="disp-leitura-msg">{{ leituraMsg }}</p>
    <p v-if="aviso" role="alert" data-testid="disp-aviso">{{ aviso }}</p>
    <p class="secundario" data-testid="disp-conexao">
      {{ conectado ? t('farmacia.conectado') : t('farmacia.desconectado') }}
    </p>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <div v-if="resultado" role="status" data-testid="disp-resultado">
      <p>{{ resultado.mensagem }}</p>
      <p v-for="a in resultado.avisos" :key="a">{{ a }}</p>
      <p v-if="resultado.etiquetas?.naFila">{{ t('farmacia.dispensacao.etiquetasFila') }}</p>
      <p v-else-if="urlEtiquetas">
        {{ t('farmacia.dispensacao.etiquetasArquivo') }}
        <a :href="urlEtiquetas" download="etiquetas-dose.zpl" data-testid="disp-etiquetas">{{
          t('farmacia.dispensacao.baixarEtiquetas')
        }}</a>
      </p>
    </div>
    <p v-if="fila.isLoading.value">{{ t('farmacia.carregando') }}</p>
    <template v-else-if="fila.data.value">
      <p>
        {{
          t('farmacia.dispensacao.janela', {
            inicio: horario(fila.data.value.inicio),
            fim: horario(fila.data.value.fim),
          })
        }}
        · {{ t('farmacia.dispensacao.total', { n: fila.data.value.total }) }}
      </p>
      <p v-if="fila.data.value.cortada">{{ t('farmacia.cortada') }}</p>
      <p v-if="pacientes.length === 0">{{ t('farmacia.nenhum') }}</p>
      <article
        v-for="p in pacientes"
        :key="p.atendimento"
        class="painel"
        :data-testid="`disp-paciente-${p.atendimento}`"
      >
        <h2>
          {{ t('farmacia.leito') }} {{ p.leito }} · {{ p.iniciais }} · {{ t('farmacia.atendimento') }}
          {{ p.atendimento }}
          <span v-if="p.alergia" class="selo">{{ t('farmacia.alergia') }}</span>
        </h2>
        <LeituraCodigo :testid="`disp-leitura-${p.atendimento}`" @lido="(r: Leitura) => lido(p, r)" />
        <p
          v-if="leituraPaciente?.atendimento === p.atendimento"
          role="status"
          :data-testid="`disp-leitura-aviso-${p.atendimento}`"
        >
          {{ leituraPaciente.texto }}
        </p>
        <table class="tabela">
          <caption class="sgh-visualmente-oculto">
            {{
              t('farmacia.dispensacao.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('farmacia.horario') }}</th>
              <th scope="col">{{ t('farmacia.item') }}</th>
              <th scope="col">{{ t('farmacia.quantidade') }}</th>
              <th scope="col">{{ t('farmacia.via') }}</th>
              <th scope="col">{{ t('farmacia.lote') }}</th>
              <th scope="col">{{ t('farmacia.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="h in p.horarios" :key="h.previsto">
              <tr v-for="d in h.doses" :key="d.horario" :data-testid="`disp-dose-${d.horario}`">
                <td>{{ horario(h.previsto) }}</td>
                <td>
                  {{ d.descricao }}
                  <span class="selo">{{ t(`farmacia.classes.${d.classe}`) }}</span>
                  <span v-if="d.controlado" class="selo">{{
                    t('farmacia.dispensacao.controlado', { lista: d.controlado })
                  }}</span>
                  <span v-if="d.urgente" class="selo">{{ t('farmacia.dispensacao.urgente') }}</span>
                </td>
                <td>
                  {{ qtd(d.quantidade) }} {{ d.unidadeDose ?? '' }}
                  <span
                    v-for="e in etiquetasDose[d.horario] ?? []"
                    :key="e"
                    class="selo"
                    :data-testid="`disp-etiqueta-${d.horario}`"
                    >{{ e }}</span
                  >
                </td>
                <td>{{ d.via ?? '—' }}</td>
                <td>
                  <template v-if="d.rastreavel">
                    <SanteSelecao
                      v-if="(lotesDoItem[d.item] ?? []).length"
                      :model-value="lotes[d.horario] ?? ''"
                      ocultar-rotulo
                      :rotulo="t('farmacia.dispensacao.loteDa', { item: d.descricao })"
                      :opcoes="opcoesLote(d)"
                      @update:model-value="(v: string) => (lotes[d.horario] = v)"
                      :data-testid="`disp-lote-${d.horario}`"
                    />
                    <span v-else class="secundario" :data-testid="`disp-sem-lote-${d.horario}`">{{
                      t('farmacia.dispensacao.semLote')
                    }}</span>
                  </template>
                  <span v-else>—</span>
                </td>
                <td>
                  <span v-if="d.bloqueio" class="secundario" :title="d.bloqueio">{{
                    t('farmacia.dispensacao.bloqueada')
                  }}</span>
                  <span v-else class="campo">
                    <input
                      :id="`disp-marca-${d.horario}`"
                      v-model="marcadas[d.horario]"
                      type="checkbox"
                      :data-testid="`disp-marca-${d.horario}`"
                    />
                    <label :for="`disp-marca-${d.horario}`">{{ t('farmacia.dispensacao.dispensar') }}</label>
                  </span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('farmacia.dispensacao.marcarTodas')"
            @acionar="marcarTodas(p)"
          />
          <SanteBotao
            variante="primario"
            :rotulo="t('farmacia.dispensacao.dispensar')"
            :desabilitado="!pode('suprimentos.dispensarHorario')"
            :data-testid="`disp-dispensar-${p.atendimento}`"
            @acionar="dispensarDo(p)"
          />
        </div>
      </article>
    </template>
  </section>
</template>
