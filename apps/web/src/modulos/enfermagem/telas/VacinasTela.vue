<script setup lang="ts">
// Vacinas aplicadas (M45, etapa 4; ficha, seção 7 e regra 18): o registro clínico da vacina aplicada (imunobiológico do
// estabelecimento, lote com a validade, dose, via, local e o vacinador), a lista com o prazo do envio à RNDS em 24 horas
// e a situação do envio pelo conector de integração (desligado, aguarda), e a prévia do registro de envio conferida no
// perfil nacional. Em `/enfermagem/vacinas`, sem atendimento, a escolha do internado (unidade e paciente) ou do
// atendimento externo do dia (a sala de vacina da consulta).
import { DOSES_VACINA, LOCAIS_VACINA, VIAS_VACINA } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  corrigirVacina,
  lerExternosVacina,
  lerRecusasRia,
  lerPacientesVacina,
  lerRia,
  lerUnidadesVacina,
  lerVacinas,
  registrarVacina,
} from '../api-sae.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const props = withDefaults(defineProps<{ reg?: string }>(), { reg: '' });
const { t } = useI18n();
const router = useRouter();
const atendimento = computed(() => Number(props.reg) || null);

// W0-03 (M6): o monitor de recusas do RIA do estabelecimento (o tratamento é o do monitor de integrações).
const recusas = useQuery({ queryKey: ['vacina', 'rnds', 'recusas'], queryFn: () => lerRecusasRia() });
const R = (k: string, p?: Record<string, unknown>) => t(`enfermagem.correcao.ria.${k}`, p ?? {});

const unidade = ref('');
const escolhido = ref('');
const unidades = useQuery({
  queryKey: ['vacina', 'unidades'],
  queryFn: () => lerUnidadesVacina(),
  enabled: computed(() => !atendimento.value),
});
const pacientes = useQuery({
  queryKey: computed(() => ['vacina', 'pacientes', unidade.value]),
  queryFn: () => lerPacientesVacina(unidade.value),
  enabled: computed(() => !atendimento.value && !!unidade.value),
});
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: '—' },
  ...(unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
]);
const opcoesPaciente = computed(() => [
  { valor: '', rotulo: '—' },
  ...(pacientes.data.value ?? []).map((p) => ({
    valor: String(p.atendimento),
    rotulo: `${p.leito} · ${p.nome} · ${t('enfermagem.comum.atendimento', { numero: p.numero })}`,
  })),
]);
function abrir(): void {
  if (escolhido.value) void router.push({ name: 'enfermagem.vacinas', params: { reg: escolhido.value } });
}
// O atendimento externo do dia (a vacina vale para o internado e para a sala de vacina da consulta).
const externo = ref('');
const externos = useQuery({
  queryKey: ['vacina', 'externos'],
  queryFn: () => lerExternosVacina(),
  enabled: computed(() => !atendimento.value),
});
const opcoesExterno = computed(() => [
  { valor: '', rotulo: '—' },
  ...(externos.data.value?.itens ?? []).map((x) => ({
    valor: String(x.atendimento),
    rotulo: `${x.entrada ? x.entrada.slice(11, 16) : '—'} · ${x.nome} · ${t('enfermagem.comum.atendimento', { numero: x.numero })}`,
  })),
]);
function abrirExterno(): void {
  if (externo.value) void router.push({ name: 'enfermagem.vacinas', params: { reg: externo.value } });
}

const dados = useQuery({
  queryKey: computed(() => ['vacina', atendimento.value]),
  queryFn: () => lerVacinas(atendimento.value!),
  enabled: computed(() => !!atendimento.value),
});
const v = computed(() => dados.data.value);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const form = reactive({
  imunobiologico: '',
  lote: '',
  fabricante: '',
  validadeLote: '',
  dose: 'D1',
  via: 'IM',
  local: 'DD',
  aplicadaEm: '',
});
const opcoesImuno = computed(() => [
  { valor: '', rotulo: '—' },
  ...(v.value?.imunobiologicos ?? []).map((i) => ({ valor: i.codigo, rotulo: i.nome })),
]);
const opcoesDose = computed(() =>
  DOSES_VACINA.map((d) => ({ valor: d, rotulo: t(`enfermagem.vacina.doses.${d}`) })),
);
const opcoesVia = VIAS_VACINA.map((x) => ({ valor: x.codigo, rotulo: x.nome }));
const opcoesLocal = LOCAIS_VACINA.map((x) => ({ valor: x.codigo, rotulo: x.nome }));
const pronto = computed(
  () =>
    !!form.imunobiologico && form.lote.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(form.validadeLote),
);
const hora = (x: string) => x.slice(0, 16).replace('T', ' ');

async function registrar(): Promise<void> {
  if (!atendimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarVacina(atendimento.value, {
      imunobiologico: form.imunobiologico,
      lote: form.lote.trim(),
      fabricante: form.fabricante.trim() || null,
      validadeLote: form.validadeLote,
      dose: form.dose,
      via: form.via,
      local: form.local,
      aplicadaEm: form.aplicadaEm || null,
    });
    mensagem.value = r.mensagem;
    form.lote = '';
    form.fabricante = '';
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// W0-03: estornar (registrada por engano) ou retificar (dado digitado errado), com o motivo; o registro da aplicação
// fica; o RIA de cancelamento ou substituição vai à fila de envio.
type VacinaDaLista = NonNullable<typeof v.value>['vacinas'][number];
const corrigindo = ref<VacinaDaLista | null>(null);
const dialogoCorrigir = ref(false);
const tipoCorrecao = ref<'retificacao' | 'estorno'>('retificacao');
const ret = reactive({ lote: '', validadeLote: '', dose: 'D1', via: 'IM', local: 'DD', aplicadaEm: '' });
const opcoesCorrecao = computed(() =>
  (['retificacao', 'estorno'] as const).map((x) => ({
    valor: x,
    rotulo: t(`enfermagem.correcao.vacina.tipos.${x}`),
  })),
);
function abrirCorrigir(x: VacinaDaLista): void {
  corrigindo.value = x;
  tipoCorrecao.value = 'retificacao';
  Object.assign(ret, {
    lote: x.lote,
    validadeLote: x.validadeLote,
    dose: x.dose,
    via: x.via,
    local: x.local,
    aplicadaEm: x.aplicadaEm.slice(0, 16),
  });
  dialogoCorrigir.value = true;
}
const mudancas = computed<Record<string, string>>(() => {
  const x = corrigindo.value;
  if (!x) return {};
  const m: Record<string, string> = {};
  if (ret.lote.trim() !== x.lote) m['lote'] = ret.lote.trim();
  if (ret.validadeLote !== x.validadeLote) m['validadeLote'] = ret.validadeLote;
  if (ret.dose !== x.dose) m['dose'] = ret.dose;
  if (ret.via !== x.via) m['via'] = ret.via;
  if (ret.local !== x.local) m['local'] = ret.local;
  if (ret.aplicadaEm && ret.aplicadaEm !== x.aplicadaEm.slice(0, 16)) m['aplicadaEm'] = ret.aplicadaEm;
  return m;
});
const podeCorrigir = computed(
  () => tipoCorrecao.value === 'estorno' || Object.keys(mudancas.value).length > 0,
);
async function corrigir(c: DadosCorrecao): Promise<void> {
  const x = corrigindo.value;
  if (!atendimento.value || !x) return;
  const r = await corrigirVacina(atendimento.value, x.id, {
    tipo: tipoCorrecao.value,
    motivo: c.motivo,
    dados: tipoCorrecao.value === 'retificacao' ? mudancas.value : null,
  });
  mensagem.value = r.mensagem;
  await dados.refetch();
}

const ria = ref<{ id: number; valido: boolean; texto: string } | null>(null);
async function verRia(id: number): Promise<void> {
  if (!atendimento.value) return;
  try {
    const r = await lerRia(atendimento.value, id);
    ria.value = { id, valido: r.valido, texto: JSON.stringify(r.recurso, null, 2) };
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="vacina-titulo" data-testid="tela-vacinas">
    <h1 id="vacina-titulo">{{ t('enfermagem.vacina.titulo') }}</h1>
    <p>{{ t('enfermagem.vacina.texto') }}</p>

    <section class="cartao" aria-labelledby="vac-ria-titulo" data-testid="vac-recusas-ria">
      <h2 id="vac-ria-titulo">{{ R('titulo') }}</h2>
      <ErroEnfermagem v-if="recusas.isError.value" :erro="recusas.error.value" />
      <template v-else-if="recusas.data.value">
        <p class="secundario" data-testid="vac-ria-destino">
          {{ R(`destinos.${recusas.data.value.destino}`) }} ·
          {{ recusas.data.value.conector.ligado ? R('conectorLigado') : R('conectorDesligado') }}
          <span v-if="recusas.data.value.destino !== 'simulador' && !recusas.data.value.credencial">
            · {{ R('semCredencial') }}</span
          >
        </p>
        <p v-if="recusas.data.value.recusas.length === 0" data-testid="vac-ria-vazio">{{ R('nenhuma') }}</p>
        <table v-else aria-labelledby="vac-ria-titulo" data-testid="vac-ria-tabela">
          <thead>
            <tr>
              <th scope="col">{{ R('vacina') }}</th>
              <th scope="col">{{ R('evento') }}</th>
              <th scope="col">{{ R('situacao') }}</th>
              <th scope="col">{{ R('tentativas') }}</th>
              <th scope="col">{{ R('motivo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in recusas.data.value.recusas" :key="x.envio" :data-testid="`vac-ria-${x.envio}`">
              <td>{{ x.vacina ?? '—' }} · {{ R('versao', { v: x.versao }) }}</td>
              <td>{{ R(`eventos.${x.evento}`) }}</td>
              <td>{{ R(`situacoes.${x.situacao}`) }}</td>
              <td>{{ x.tentativas }}</td>
              <td>{{ x.motivo }}</td>
            </tr>
          </tbody>
        </table>
        <RouterLink :to="{ name: 'integracoes.monitor' }" data-testid="vac-ria-monitor">{{
          R('tratar')
        }}</RouterLink>
      </template>
    </section>

    <template v-if="!atendimento">
      <h2 id="vac-internado-titulo">{{ t('enfermagem.vacina.internadoTitulo') }}</h2>
      <p>{{ t('enfermagem.vacina.escolha') }}</p>
      <div class="barra">
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('enfermagem.comum.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="vac-unidade"
        />
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('enfermagem.vacina.paciente')"
          :opcoes="opcoesPaciente"
          data-testid="vac-paciente"
        />
        <SanteBotao
          :rotulo="t('enfermagem.vacina.abrir')"
          :desabilitado="!escolhido"
          data-testid="vac-abrir"
          @acionar="abrir"
        />
      </div>
      <ErroEnfermagem v-if="unidades.isError.value" :erro="unidades.error.value" />
      <h2 id="vac-externo-titulo">{{ t('enfermagem.vacina.externoTitulo') }}</h2>
      <p>{{ t('enfermagem.vacina.externoTexto') }}</p>
      <div class="barra" role="group" aria-labelledby="vac-externo-titulo">
        <SanteSelecao
          v-model="externo"
          :rotulo="t('enfermagem.vacina.externo')"
          :opcoes="opcoesExterno"
          :busca="true"
          data-testid="vac-externo"
        />
        <SanteBotao
          :rotulo="t('enfermagem.vacina.abrir')"
          :desabilitado="!externo"
          data-testid="vac-abrir-externo"
          @acionar="abrirExterno"
        />
      </div>
      <p v-if="externos.data.value?.cortada" class="secundario">
        {{ t('enfermagem.vacina.externosCortada') }}
      </p>
      <p v-else-if="externos.data.value && externos.data.value.itens.length === 0" class="secundario">
        {{ t('enfermagem.vacina.semExternos') }}
      </p>
      <ErroEnfermagem v-if="externos.isError.value" :erro="externos.error.value" />
    </template>

    <template v-else>
      <ErroEnfermagem v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!v" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <p class="cabecalho" data-testid="vac-cabecalho">
          <strong>{{ v.nome }}</strong>
          <span v-if="v.leito"> · {{ v.leito }}</span> ·
          {{ t('enfermagem.comum.atendimento', { numero: v.numero }) }}
        </p>
        <SanteAlerta
          v-if="!v.gravacao.ligada"
          variante="aviso"
          :texto="t('enfermagem.vacina.desligado', { motivo: v.gravacao.motivo ?? '' })"
        />
        <SanteAlerta
          v-if="!v.conector.ligado"
          variante="info"
          :texto="t('enfermagem.vacina.conectorDesligado', { motivo: v.conector.motivo ?? '' })"
          data-testid="vac-conector"
        />
        <SanteAlerta
          v-if="v.imunobiologicos.length === 0"
          variante="aviso"
          :texto="t('enfermagem.vacina.semImunobiologicos')"
        />
        <p v-if="mensagem" role="status" data-testid="vac-mensagem">{{ mensagem }}</p>
        <ErroEnfermagem v-if="erro" :erro="erro" />

        <form v-if="v.gravacao.registrar" class="cartao" data-testid="vac-form" @submit.prevent="registrar">
          <div class="barra">
            <SanteSelecao
              v-model="form.imunobiologico"
              :rotulo="t('enfermagem.vacina.imunobiologico')"
              :opcoes="opcoesImuno"
              data-testid="vac-imuno"
            />
            <SanteCampoTexto
              id="vac-lote"
              v-model="form.lote"
              :rotulo="t('enfermagem.vacina.lote')"
              :max-bytes="30"
            />
            <SanteCampoTexto
              id="vac-fabricante"
              v-model="form.fabricante"
              :rotulo="t('enfermagem.vacina.fabricante')"
              :max-bytes="80"
            />
            <span class="campo">
              <label for="vac-validade">{{ t('enfermagem.vacina.validade') }}</label>
              <input id="vac-validade" v-model="form.validadeLote" type="date" data-testid="vac-validade" />
            </span>
          </div>
          <div class="barra">
            <SanteSelecao
              v-model="form.dose"
              :rotulo="t('enfermagem.vacina.dose')"
              :opcoes="opcoesDose"
              data-testid="vac-dose"
            />
            <SanteSelecao
              v-model="form.via"
              :rotulo="t('enfermagem.vacina.via')"
              :opcoes="opcoesVia"
              data-testid="vac-via"
            />
            <SanteSelecao
              v-model="form.local"
              :rotulo="t('enfermagem.vacina.local')"
              :opcoes="opcoesLocal"
              data-testid="vac-local"
            />
            <span class="campo">
              <label for="vac-aplicada">{{ t('enfermagem.vacina.aplicadaEm') }}</label>
              <input
                id="vac-aplicada"
                v-model="form.aplicadaEm"
                type="datetime-local"
                data-testid="vac-aplicada"
              />
            </span>
          </div>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.vacina.registrar')"
            :desabilitado="!pronto || ocupado"
            data-testid="vac-registrar"
          />
        </form>

        <section aria-labelledby="vac-lista">
          <h2 id="vac-lista">{{ t('enfermagem.vacina.lista') }}</h2>
          <p v-if="v.vacinas.length === 0">{{ t('enfermagem.vacina.vazio') }}</p>
          <ul data-testid="vac-vacinas">
            <li
              v-for="x in v.vacinas"
              :key="x.id"
              :class="{ inativo: x.situacao === 'estornada' }"
              :data-testid="`vac-${x.id}`"
              :data-envio="x.envio.situacao"
              :data-situacao="x.situacao ?? 'ativa'"
            >
              <component :is="x.situacao === 'estornada' ? 's' : 'span'"
                >{{ hora(x.aplicadaEm) }} · {{ x.nome }} · {{ t(`enfermagem.vacina.doses.${x.dose}`) }} ·
                {{ x.lote }} · {{ x.via }} · {{ x.local }} · {{ x.usuario }}</component
              >
              ·
              <strong v-if="x.situacao && x.situacao !== 'ativa'">
                {{ t(`enfermagem.correcao.vacina.situacoes.${x.situacao}`) }} ·
              </strong>
              {{ t('enfermagem.vacina.prazo', { prazo: hora(x.prazoEnvio) }) }} ·
              <strong>{{ t(`enfermagem.vacina.envio.${x.envio.situacao}`) }}</strong>
              <span v-if="x.envio.vencido" class="alerta"> · {{ t('enfermagem.vacina.vencido') }}</span>
              <SanteBotao
                variante="texto"
                :rotulo="t('enfermagem.vacina.ria')"
                :data-testid="`vac-ria-${x.id}`"
                @acionar="verRia(x.id)"
              />
              <SanteBotao
                v-if="x.situacao !== 'estornada'"
                variante="texto"
                :rotulo="t('enfermagem.correcao.vacina.corrigir')"
                :desabilitado="!v.gravacao.registrar"
                :data-testid="`vac-corrigir-${x.id}`"
                @acionar="abrirCorrigir(x)"
              />
              <p v-if="x.original" class="secundario" :data-testid="`vac-original-${x.id}`">
                {{
                  t('enfermagem.correcao.vacina.original', {
                    lote: x.original.lote,
                    validade: x.original.validadeLote,
                    dose: t(`enfermagem.vacina.doses.${x.original.dose}`),
                    via: x.original.via,
                    local: x.original.local,
                    quando: hora(x.original.aplicadaEm),
                  })
                }}
              </p>
              <ul v-if="x.correcoes?.length" class="secundario" :data-testid="`vac-correcoes-${x.id}`">
                <li v-for="c in x.correcoes" :key="c.versao">
                  {{
                    t('enfermagem.correcao.vacina.correcao', {
                      versao: c.versao,
                      tipo: t(`enfermagem.correcao.vacina.tiposCurtos.${c.tipo}`),
                      por: c.usuario,
                      quando: hora(c.em),
                      motivo: c.motivo,
                      envio: t(`enfermagem.vacina.envio.${c.envio.situacao}`),
                    })
                  }}
                </li>
              </ul>
            </li>
          </ul>
          <template v-if="ria">
            <SanteAlerta
              :variante="ria.valido ? 'info' : 'aviso'"
              :texto="ria.valido ? t('enfermagem.vacina.riaValido') : t('enfermagem.vacina.riaInvalido')"
              data-testid="vac-ria-situacao"
            />
            <pre class="ria" data-testid="vac-ria">{{ ria.texto }}</pre>
          </template>
        </section>
      </template>
    </template>
    <DialogoCorrecao
      v-model:visivel="dialogoCorrigir"
      :titulo="t('enfermagem.correcao.vacina.titulo')"
      :texto="t('enfermagem.correcao.vacina.texto')"
      testid="vac-dialogo-corrigir"
      :pode-confirmar="podeCorrigir"
      :executar="corrigir"
    >
      <SanteOpcoes
        v-model="tipoCorrecao"
        :legenda="t('enfermagem.correcao.vacina.tipo')"
        :opcoes="opcoesCorrecao"
        nome="vac-correcao-tipo"
      />
      <div v-if="tipoCorrecao === 'retificacao'" class="barra">
        <SanteCampoTexto
          id="vac-ret-lote"
          v-model="ret.lote"
          :rotulo="t('enfermagem.vacina.lote')"
          :max-bytes="30"
          data-testid="vac-ret-lote"
        />
        <span class="campo">
          <label for="vac-ret-validade">{{ t('enfermagem.vacina.validade') }}</label>
          <input id="vac-ret-validade" v-model="ret.validadeLote" type="date" />
        </span>
        <SanteSelecao v-model="ret.dose" :rotulo="t('enfermagem.vacina.dose')" :opcoes="opcoesDose" />
        <SanteSelecao v-model="ret.via" :rotulo="t('enfermagem.vacina.via')" :opcoes="opcoesVia" />
        <SanteSelecao v-model="ret.local" :rotulo="t('enfermagem.vacina.local')" :opcoes="opcoesLocal" />
        <span class="campo">
          <label for="vac-ret-aplicada">{{ t('enfermagem.correcao.vacina.aplicadaEm') }}</label>
          <input id="vac-ret-aplicada" v-model="ret.aplicadaEm" type="datetime-local" />
        </span>
        <p v-if="!podeCorrigir" class="secundario">{{ t('enfermagem.correcao.vacina.semMudanca') }}</p>
      </div>
    </DialogoCorrecao>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.ria {
  white-space: pre-wrap;
  max-height: 20rem;
  overflow: auto;
}
</style>
