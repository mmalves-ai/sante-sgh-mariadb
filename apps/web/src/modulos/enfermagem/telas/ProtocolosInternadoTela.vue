<script setup lang="ts">
// W0-03, mercado M3: o relógio de protocolos gerenciados no internado (unidade de internação ou UTI). No alto, os alertas
// do NEWS2 sem protocolo de sepse (a inclusão pelo alerta: a hora dele é o tempo zero) e o botão da inclusão por
// suspeita (com a hora do reconhecimento). Um cartão por protocolo em andamento: cada meta com o prazo e a situação
// escrita, o registro (feita ou não, com o motivo), o encerramento e a inativação da inclusão por engano (só do autor,
// com motivo e senha). Os encerrados e os inativados (tachados) ficam visíveis. Os indicadores por origem (PA,
// internação, UTI) imprimem o numerador e o denominador. Tudo o que decide vem do servidor (a tela só mostra).
import {
  DESFECHOS_PROTOCOLO,
  type DesfechoProtocolo,
  type IndicadorOrigemProtocolo,
  type ProtocoloInternado,
  type SugestaoNews2,
  type TipoProtocoloInternado,
} from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  encerrarProtocoloInternado,
  inativarProtocoloInternado,
  incluirProtocoloInternado,
  lerIndicadoresProtocolo,
  lerRelogioInternado,
  registrarMetaInternado,
} from '../api-protocolo-internado.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const uid = `pi-${useId()}`;
const { unidade, escolherUnidade, opcoesUnidade, login } = usarEnfermagem();
const ehMeu = (u: string | null | undefined) =>
  !!login.value && (u ?? '').toUpperCase() === login.value.toUpperCase();
const tela = useQuery({
  queryKey: computed(() => ['enfermagem', 'protocolos-internado', unidade.value]),
  queryFn: () => lerRelogioInternado(unidade.value),
  enabled: computed(() => unidade.value !== ''),
  refetchInterval: 60_000,
});
const dados = computed(() => tela.data.value ?? null);
const mensagem = ref<string | null>(null);
const hora = (x: string | null | undefined) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const horaCurta = (x: string | null | undefined) => (x ? x.slice(11, 16) : '—');
const nomeTipo = (tipo: string) => t(`protocolos.tipos.${tipo}`);
const agoraLocal = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
async function recarregar(): Promise<void> {
  await tela.refetch();
}

// ── A inclusão (pelo alerta ou por suspeita) ─────────────────────────────────────────
const dialogoIncluir = ref(false);
const alerta = ref<SugestaoNews2 | null>(null);
const atendimento = ref<number | null>(null);
const tipo = ref<TipoProtocoloInternado>('sepse');
const reconhecidoEm = ref('');
const criterios = ref<string[]>([]);
const observacao = ref('');
const erroIncluir = ref<unknown>(null);
const opcoesPaciente = computed(() => [
  { valor: null, rotulo: t('enfermagem.protocoloInternado.incluir.escolhaPaciente') },
  ...(dados.value?.pacientes ?? []).map((p) => ({ valor: p.atendimento, rotulo: `${p.leito} · ${p.nome}` })),
]);
const opcoesTipo = computed(() =>
  (dados.value?.vigentes ?? []).map((v) => ({ valor: v.tipo, rotulo: nomeTipo(v.tipo) })),
);
const vigente = computed(() => dados.value?.vigentes.find((v) => v.tipo === tipo.value) ?? null);
function abrirIncluir(s: SugestaoNews2 | null): void {
  alerta.value = s;
  atendimento.value = s?.atendimento ?? null;
  tipo.value = s ? 'sepse' : (dados.value?.vigentes[0]?.tipo ?? 'sepse');
  reconhecidoEm.value = agoraLocal();
  criterios.value = [];
  observacao.value = '';
  erroIncluir.value = null;
  dialogoIncluir.value = true;
}
const incluirValido = computed(
  () =>
    atendimento.value !== null &&
    vigente.value !== null &&
    criterios.value.length > 0 &&
    (alerta.value !== null || reconhecidoEm.value !== ''),
);
async function confirmarIncluir(): Promise<void> {
  if (!incluirValido.value || !vigente.value || atendimento.value === null) return;
  erroIncluir.value = null;
  try {
    const r = await incluirProtocoloInternado({
      atendimento: atendimento.value,
      tipo: tipo.value,
      versao: vigente.value.id,
      origem: alerta.value ? 'news2' : 'suspeita',
      escore: alerta.value?.escore ?? null,
      reconhecidoEm: alerta.value ? null : reconhecidoEm.value,
      criterios: [...criterios.value],
      observacao: observacao.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    dialogoIncluir.value = false;
    await recarregar();
  } catch (x) {
    erroIncluir.value = x;
  }
}

// ── A meta ou o item do checklist ──────────────────────────────────────────────────────
type MetaTela = ProtocoloInternado['metas'][number];
const dialogoMeta = ref(false);
const alvoMeta = ref<{ p: ProtocoloInternado; m: MetaTela } | null>(null);
const feita = ref<'cumprida' | 'perdida'>('cumprida');
const quando = ref('');
const motivoMeta = ref('');
const erroMeta = ref<unknown>(null);
const opcoesFeita = computed(() => [
  { valor: 'cumprida' as const, rotulo: t('enfermagem.protocoloInternado.meta.cumprida') },
  { valor: 'perdida' as const, rotulo: t('enfermagem.protocoloInternado.meta.perdida') },
]);
function abrirMeta(p: ProtocoloInternado, m: MetaTela): void {
  alvoMeta.value = { p, m };
  feita.value = 'cumprida';
  quando.value = agoraLocal();
  motivoMeta.value = '';
  erroMeta.value = null;
  dialogoMeta.value = true;
}
async function confirmarMeta(): Promise<void> {
  const a = alvoMeta.value;
  if (!a) return;
  erroMeta.value = null;
  try {
    const r = await registrarMetaInternado(a.p.id, {
      tipo: a.m.tipo,
      codigo: a.m.codigo,
      situacao: feita.value,
      quando: feita.value === 'cumprida' ? quando.value : null,
      motivo: motivoMeta.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    dialogoMeta.value = false;
    await recarregar();
  } catch (x) {
    erroMeta.value = x;
  }
}

// ── O encerramento e a inativação ─────────────────────────────────────────────────────
const dialogoEncerrar = ref(false);
const dialogoInativar = ref(false);
const alvo = ref<ProtocoloInternado | null>(null);
const desfecho = ref<DesfechoProtocolo>('concluido');
const motivoEncerrar = ref('');
const erroEncerrar = ref<unknown>(null);
const opcoesDesfecho = computed(() =>
  DESFECHOS_PROTOCOLO.map((d) => ({ valor: d.codigo, rotulo: t(`protocolos.desfechos.${d.codigo}`) })),
);
function abrirEncerrar(p: ProtocoloInternado): void {
  alvo.value = p;
  desfecho.value = 'concluido';
  motivoEncerrar.value = '';
  erroEncerrar.value = null;
  dialogoEncerrar.value = true;
}
async function confirmarEncerrar(): Promise<void> {
  const p = alvo.value;
  if (!p) return;
  erroEncerrar.value = null;
  try {
    const r = await encerrarProtocoloInternado(p.id, {
      desfecho: desfecho.value,
      motivo: motivoEncerrar.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    dialogoEncerrar.value = false;
    await recarregar();
  } catch (x) {
    erroEncerrar.value = x;
  }
}
function abrirInativar(p: ProtocoloInternado): void {
  alvo.value = p;
  dialogoInativar.value = true;
}
async function inativar(c: DadosCorrecao): Promise<void> {
  const p = alvo.value;
  if (!p) return;
  mensagem.value = (await inativarProtocoloInternado(p.id, c.motivo, c.senha)).mensagem;
  await recarregar();
}

// ── Os indicadores por origem ─────────────────────────────────────────────────────────
const indicadoresPeriodo = ref<IndicadorOrigemProtocolo[] | null>(null);
const de = ref('');
const ate = ref('');
const erroIndicador = ref<unknown>(null);
const indicadores = computed(() => indicadoresPeriodo.value ?? dados.value?.indicadores ?? []);
const periodo = computed(() =>
  indicadoresPeriodo.value ? { desde: de.value, ate: ate.value } : (dados.value?.periodo ?? null),
);
async function calcular(): Promise<void> {
  erroIndicador.value = null;
  try {
    indicadoresPeriodo.value = (await lerIndicadoresProtocolo(de.value, ate.value)).indicadores;
  } catch (x) {
    erroIndicador.value = x;
  }
}
const pct = (v: number | null) =>
  v === null ? t('enfermagem.protocoloInternado.indicadores.semDenominador') : `${v}%`;
const acoes = computed(() => dados.value?.acoes ?? null);
</script>

<template>
  <section class="tela-enf" :aria-labelledby="`${uid}-titulo`" data-testid="tela-protocolos-internado">
    <h1 :id="`${uid}-titulo`">{{ t('enfermagem.protocoloInternado.titulo') }}</h1>
    <p>{{ t('enfermagem.protocoloInternado.texto') }}</p>
    <p class="base">
      {{ t('enfermagem.protocoloInternado.base') }}
      <RouterLink to="/pa/protocolos">{{ t('enfermagem.protocoloInternado.atalhoPa') }}</RouterLink>
    </p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <SanteBotao
        v-if="acoes?.incluir"
        :rotulo="t('enfermagem.protocoloInternado.incluir.botao')"
        data-testid="pi-incluir"
        @acionar="abrirIncluir(null)"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="pi-mensagem">{{ mensagem }}</p>
    <p v-if="acoes && acoes.motivo" role="note" data-testid="pi-sem-acao">
      {{ t('enfermagem.protocoloInternado.semGravacao', { motivo: acoes.motivo }) }}
    </p>
    <ErroEnfermagem v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!dados" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <!-- O aviso único: os alertas do NEWS2 sem protocolo de sepse. -->
      <section
        class="cartao"
        :class="{ alerta: dados.sugestoes.length > 0 }"
        :role="dados.sugestoes.length > 0 ? 'alert' : undefined"
        data-testid="pi-sugestoes"
        :aria-labelledby="`${uid}-sug`"
      >
        <h2 :id="`${uid}-sug`">{{ t('enfermagem.protocoloInternado.sugestoes.titulo') }}</h2>
        <p class="discreto">
          {{ t('enfermagem.protocoloInternado.sugestoes.texto', { limiar: dados.limiarNews2 }) }}
        </p>
        <p v-if="dados.sugestoes.length === 0">{{ t('enfermagem.protocoloInternado.sugestoes.nenhuma') }}</p>
        <ul v-else class="lista">
          <li v-for="s in dados.sugestoes" :key="s.escore" :data-testid="`pi-sugestao-${s.escore}`">
            {{
              t('enfermagem.protocoloInternado.sugestoes.item', {
                paciente: s.paciente,
                total: s.total,
                hora: horaCurta(s.em),
              })
            }}
            <SanteBotao
              v-if="acoes?.incluir"
              variante="secundario"
              :rotulo="t('enfermagem.protocoloInternado.sugestoes.incluir')"
              :data-testid="`pi-sugestao-incluir-${s.escore}`"
              @acionar="abrirIncluir(s)"
            />
          </li>
        </ul>
      </section>

      <h2>{{ t('enfermagem.protocoloInternado.ativos.titulo') }}</h2>
      <p v-if="dados.ativos.length === 0">{{ t('enfermagem.protocoloInternado.ativos.nenhum') }}</p>
      <ul v-else class="cartoes" data-testid="pi-ativos">
        <li v-for="p in dados.ativos" :key="p.id" class="cartao" :data-testid="`pi-protocolo-${p.id}`">
          <header class="cab">
            <strong>{{ p.paciente }} · {{ nomeTipo(p.tipo) }}</strong>
            <span class="selo">{{ t(`enfermagem.protocoloInternado.locais.${p.local}`) }}</span>
          </header>
          <p class="discreto">
            {{ t('enfermagem.protocoloInternado.cartao.tempoZero', { hora: hora(p.reconhecidoEm) }) }} ·
            {{
              p.origem === 'news2' && p.escore
                ? t('enfermagem.protocoloInternado.origens.news2', {
                    total: p.escore.total,
                    hora: horaCurta(p.escore.em),
                  })
                : t('enfermagem.protocoloInternado.origens.suspeita')
            }}
            <strong
              v-if="p.origem === 'news2' && p.escore?.estornado"
              class="atraso"
              :data-testid="`pi-escore-estornado-${p.id}`"
              >{{ t('enfermagem.protocoloInternado.origens.escoreEstornado') }}</strong
            >
            ·
            {{
              t('enfermagem.protocoloInternado.cartao.incluidoPor', {
                por: p.incluidoPor,
                em: hora(p.incluidoEm),
              })
            }}
          </p>
          <p v-if="p.atrasadas > 0" class="atraso" data-testid="pi-atrasadas">
            {{ t('enfermagem.protocoloInternado.cartao.atrasadas', { n: p.atrasadas }) }}
          </p>
          <table class="grade">
            <tbody>
              <tr
                v-for="m in p.metas"
                :key="`${m.tipo}-${m.codigo}`"
                :data-testid="`pi-meta-${p.id}-${m.codigo}`"
              >
                <td>{{ m.titulo }}</td>
                <td>
                  <span :class="['situacao', m.situacao]">{{ t(`protocolos.situacoes.${m.situacao}`) }}</span>
                </td>
                <td class="discreto">
                  <template v-if="m.quando || m.por">
                    {{
                      t('enfermagem.protocoloInternado.cartao.feitaEm', {
                        hora: horaCurta(m.quando),
                        por: m.por ?? '',
                      })
                    }}
                    <span v-if="m.motivo"> · {{ m.motivo }}</span>
                  </template>
                  <template v-else-if="m.prazoEm">
                    {{ t('enfermagem.protocoloInternado.cartao.prazo', { hora: horaCurta(m.prazoEm) }) }}
                    <span v-if="m.minutosRestantes !== null">
                      ·
                      {{
                        m.minutosRestantes >= 0
                          ? t('enfermagem.protocoloInternado.cartao.restam', { n: m.minutosRestantes })
                          : t('enfermagem.protocoloInternado.cartao.passou', { n: -m.minutosRestantes })
                      }}
                    </span>
                  </template>
                </td>
                <td>
                  <SanteBotao
                    v-if="acoes?.registrar && !m.por"
                    variante="secundario"
                    :rotulo="t('enfermagem.protocoloInternado.cartao.registrar')"
                    :data-testid="`pi-registrar-${p.id}-${m.codigo}`"
                    @acionar="abrirMeta(p, m)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <div class="acoes">
            <SanteBotao
              v-if="acoes?.registrar"
              :rotulo="t('enfermagem.protocoloInternado.cartao.encerrar')"
              :data-testid="`pi-encerrar-${p.id}`"
              @acionar="abrirEncerrar(p)"
            />
            <SanteBotao
              v-if="ehMeu(p.incluidoPor)"
              variante="secundario"
              :rotulo="t('enfermagem.protocoloInternado.cartao.inativar')"
              :data-testid="`pi-inativar-${p.id}`"
              @acionar="abrirInativar(p)"
            />
          </div>
        </li>
      </ul>

      <h2>{{ t('enfermagem.protocoloInternado.encerrados.titulo') }}</h2>
      <p v-if="dados.encerrados.length === 0">{{ t('enfermagem.protocoloInternado.encerrados.nenhum') }}</p>
      <ul v-else class="cartoes" data-testid="pi-encerrados">
        <li
          v-for="p in dados.encerrados"
          :key="p.id"
          class="cartao"
          :class="{ inativo: p.inativacao }"
          :data-testid="`pi-encerrado-${p.id}`"
        >
          <header class="cab">
            <strong :class="{ tachado: p.inativacao }">{{ p.paciente }} · {{ nomeTipo(p.tipo) }}</strong>
            <span class="selo">{{ t(`enfermagem.protocoloInternado.locais.${p.local}`) }}</span>
          </header>
          <p v-if="p.inativacao" data-testid="pi-inativacao">
            {{
              t('enfermagem.protocoloInternado.encerrados.inativado', {
                por: p.inativacao.por,
                em: hora(p.inativacao.em),
                motivo: p.inativacao.motivo,
              })
            }}
          </p>
          <p v-if="p.encerramento">
            {{
              t('enfermagem.protocoloInternado.encerrados.encerrado', {
                desfecho: t(`protocolos.desfechos.${p.encerramento.desfecho}`),
                em: hora(p.encerramento.em),
                por: p.encerramento.por,
              })
            }}
            <span v-if="p.encerramento.motivo"> · {{ p.encerramento.motivo }}</span>
          </p>
          <ul class="lista discreto" :class="{ tachado: p.inativacao }">
            <li v-for="m in p.metas" :key="`${m.tipo}-${m.codigo}`">
              {{ m.titulo }}: {{ t(`protocolos.situacoes.${m.situacao}`) }}
            </li>
          </ul>
          <div v-if="!p.inativacao && ehMeu(p.incluidoPor)" class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.protocoloInternado.cartao.inativar')"
              :data-testid="`pi-inativar-${p.id}`"
              @acionar="abrirInativar(p)"
            />
          </div>
        </li>
      </ul>

      <section class="cartao" :aria-labelledby="`${uid}-ind`" data-testid="pi-indicadores">
        <h2 :id="`${uid}-ind`">{{ t('enfermagem.protocoloInternado.indicadores.titulo') }}</h2>
        <p v-if="periodo" class="discreto">
          {{
            t('enfermagem.protocoloInternado.indicadores.periodo', { de: periodo.desde, ate: periodo.ate })
          }}
        </p>
        <form class="barra" @submit.prevent="calcular">
          <span class="campo">
            <label :for="`${uid}-de`">{{ t('enfermagem.protocoloInternado.indicadores.de') }}</label>
            <input :id="`${uid}-de`" v-model="de" type="date" data-testid="pi-ind-de" />
          </span>
          <span class="campo">
            <label :for="`${uid}-ate`">{{ t('enfermagem.protocoloInternado.indicadores.ate') }}</label>
            <input :id="`${uid}-ate`" v-model="ate" type="date" data-testid="pi-ind-ate" />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.protocoloInternado.indicadores.calcular')"
            :desabilitado="!de || !ate"
            data-testid="pi-ind-calcular"
          />
        </form>
        <ErroEnfermagem v-if="erroIndicador" :erro="erroIndicador" />
        <p v-if="indicadores.length === 0">{{ t('enfermagem.protocoloInternado.indicadores.nenhum') }}</p>
        <table v-else class="grade" data-testid="pi-ind-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.local') }}</th>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.tipo') }}</th>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.inclusoes') }}</th>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.pelaNews2') }}</th>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.adesao') }}</th>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.pacote') }}</th>
              <th scope="col">{{ t('enfermagem.protocoloInternado.indicadores.obitos') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in indicadores"
              :key="`${x.local}-${x.tipo}`"
              :data-testid="`pi-ind-${x.local}-${x.tipo}`"
            >
              <td>{{ t(`enfermagem.protocoloInternado.locais.${x.local}`) }}</td>
              <td>
                {{
                  x.tipo === 'todos' ? t('enfermagem.protocoloInternado.indicadores.todos') : nomeTipo(x.tipo)
                }}
              </td>
              <td>{{ x.inclusoes }}</td>
              <td>{{ x.pelaNews2 }}</td>
              <td>
                {{ pct(x.adesaoPercentual) }}
                ({{
                  t('enfermagem.protocoloInternado.indicadores.formula', {
                    num: x.metasCumpridas,
                    den: x.metasRegistradas,
                  })
                }})
              </td>
              <td>
                {{ pct(x.pacotePercentual) }}
                ({{
                  t('enfermagem.protocoloInternado.indicadores.formula', {
                    num: x.pacoteCompleto,
                    den: x.encerradas,
                  })
                }})
              </td>
              <td>{{ x.obitos }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="dialogoIncluir"
      :titulo="t('enfermagem.protocoloInternado.incluir.titulo')"
    >
      <form class="form" data-testid="pi-dialogo-incluir" @submit.prevent="confirmarIncluir">
        <p v-if="alerta">
          <strong>{{ alerta.paciente }}</strong> ·
          {{
            t('enfermagem.protocoloInternado.incluir.alerta', {
              total: alerta.total,
              hora: horaCurta(alerta.em),
            })
          }}
        </p>
        <template v-else>
          <SanteSelecao
            v-model="atendimento"
            :rotulo="t('enfermagem.protocoloInternado.incluir.paciente')"
            :opcoes="opcoesPaciente"
            obrigatorio
            data-testid="pi-paciente"
          />
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('enfermagem.protocoloInternado.incluir.tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="pi-tipo"
          />
          <span class="campo">
            <label :for="`${uid}-rec`">{{ t('enfermagem.protocoloInternado.incluir.reconhecidoEm') }}</label>
            <input
              :id="`${uid}-rec`"
              v-model="reconhecidoEm"
              type="datetime-local"
              required
              data-testid="pi-reconhecido"
            />
          </span>
        </template>
        <p v-if="!vigente" role="note">{{ t('enfermagem.protocoloInternado.incluir.semDefinicao') }}</p>
        <fieldset v-else class="criterios">
          <legend>{{ t('enfermagem.protocoloInternado.incluir.criterios') }}</legend>
          <label v-for="c in vigente.criterios" :key="c.codigo">
            <input
              v-model="criterios"
              type="checkbox"
              :value="c.codigo"
              :data-testid="`pi-criterio-${c.codigo}`"
            />
            {{ c.titulo }}
          </label>
        </fieldset>
        <span class="campo">
          <label :for="`${uid}-obs`">{{ t('enfermagem.protocoloInternado.incluir.observacao') }}</label>
          <textarea :id="`${uid}-obs`" v-model="observacao" maxlength="300" rows="2" />
        </span>
        <ErroEnfermagem v-if="erroIncluir" :erro="erroIncluir" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.protocoloInternado.incluir.confirmar')"
            :desabilitado="!incluirValido"
            data-testid="pi-incluir-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoIncluir = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoMeta"
      :titulo="t('enfermagem.protocoloInternado.meta.titulo', { item: alvoMeta?.m.titulo ?? '' })"
    >
      <form class="form" data-testid="pi-dialogo-meta" @submit.prevent="confirmarMeta">
        <SanteOpcoes
          v-model="feita"
          :legenda="t('enfermagem.protocoloInternado.meta.situacao')"
          :opcoes="opcoesFeita"
          data-testid="pi-meta-situacao"
        />
        <span v-if="feita === 'cumprida'" class="campo">
          <label :for="`${uid}-quando`">{{ t('enfermagem.protocoloInternado.meta.quando') }}</label>
          <input
            :id="`${uid}-quando`"
            v-model="quando"
            type="datetime-local"
            required
            data-testid="pi-meta-quando"
          />
        </span>
        <span class="campo">
          <label :for="`${uid}-mot`">{{ t('enfermagem.protocoloInternado.meta.motivo') }}</label>
          <textarea
            :id="`${uid}-mot`"
            v-model="motivoMeta"
            maxlength="300"
            rows="2"
            data-testid="pi-meta-motivo"
          />
        </span>
        <ErroEnfermagem v-if="erroMeta" :erro="erroMeta" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.protocoloInternado.meta.confirmar')"
            :desabilitado="feita === 'perdida' && motivoMeta.trim().length < 3"
            data-testid="pi-meta-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoMeta = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoEncerrar"
      :titulo="t('enfermagem.protocoloInternado.encerrar.titulo')"
    >
      <form class="form" data-testid="pi-dialogo-encerrar" @submit.prevent="confirmarEncerrar">
        <SanteSelecao
          v-model="desfecho"
          :rotulo="t('enfermagem.protocoloInternado.encerrar.desfecho')"
          :opcoes="opcoesDesfecho"
          obrigatorio
          data-testid="pi-desfecho"
        />
        <span class="campo">
          <label :for="`${uid}-motenc`">{{ t('enfermagem.protocoloInternado.encerrar.motivo') }}</label>
          <textarea
            :id="`${uid}-motenc`"
            v-model="motivoEncerrar"
            maxlength="300"
            rows="2"
            data-testid="pi-encerrar-motivo"
          />
        </span>
        <ErroEnfermagem v-if="erroEncerrar" :erro="erroEncerrar" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.protocoloInternado.encerrar.confirmar')"
            data-testid="pi-encerrar-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoEncerrar = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <DialogoCorrecao
      v-model:visivel="dialogoInativar"
      :titulo="t('enfermagem.protocoloInternado.inativar.titulo')"
      :texto="t('enfermagem.protocoloInternado.inativar.texto')"
      :rotulo-confirmar="t('enfermagem.protocoloInternado.cartao.inativar')"
      com-senha
      testid="pi-dialogo-inativar"
      :executar="inativar"
    />
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.base,
.discreto {
  color: var(--sgh-texto-secundario);
}
.cartoes,
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.cab {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
}
.selo {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio-1, 4px);
  padding: 0 var(--sgh-espaco-1);
}
.atraso {
  font-weight: 600;
}
.situacao.vencida,
.situacao.perdida {
  font-weight: 600;
}
.tachado {
  text-decoration: line-through;
}
.inativo {
  opacity: 0.8;
}
.criterios {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
