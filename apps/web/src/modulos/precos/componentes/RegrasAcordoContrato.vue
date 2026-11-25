<script setup lang="ts">
// Seção "Regras do acordo" da tela do contrato (F3.7, 06-FAT linha 1): as seis regras do acordo com a fonte pagadora
// (percentual por parcela, desconto por grupo de despesa, via de acesso, item isento, teto e alto custo), cada uma com
// a vigência e "vigente na data". Um tipo de cada vez, com a lista e o formulário juntos (menos cliques); o formulário
// valida na hora pelas mesmas regras do domínio que a API usa e só grava quando está válido. Nada se apaga: incluir
// encerra a regra igual anterior na véspera; encerrar só mexe no fim da vigência, nunca antes de hoje.
import {
  ABRANGENCIAS_TETO,
  ACOES_TETO,
  COMPONENTES_PERCENTUAL,
  CRITERIOS_ORDEM_VIA,
  type ErrosRegra,
  PARCELAS_DESCONTO,
  REGIMES_DESCONTO,
  REGRAS_ALTO_CUSTO,
  TIPOS_PACIENTE_REGRA,
  TIPOS_REGRA_ACORDO,
  type TipoRegraAcordo,
  validarAltoCusto,
  validarDescontoGrupo,
  validarIsento,
  validarPercentualCobranca,
  validarTeto,
  validarViaAcesso,
} from '@sgh/dominio-preco';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  encerrarRegraAcordo,
  incluirRegraAcordo,
  lerRegrasAcordo,
  type RegrasAcordo,
} from '../api-regras-acordo.js';
import { mensagensRegrasAcordo } from '../i18n-regras-acordo.js';

const props = defineProps<{ codigo: number; podeEditar: boolean }>();
// Textos próprios da seção (escopo local), sem mexer nas mensagens comuns da aplicação.
const { t } = useI18n({
  useScope: 'local',
  inheritLocale: true,
  messages: { 'pt-BR': { regrasAcordo: mensagensRegrasAcordo } },
});
const cliente = useQueryClient();
const hoje = new Date().toISOString().slice(0, 10);

const consulta = useQuery({
  queryKey: computed(() => ['convenio', 'regras-acordo', props.codigo]),
  queryFn: () => lerRegrasAcordo(props.codigo),
});

const tipo = ref<TipoRegraAcordo>('percentual');
const opcoesTipo = TIPOS_REGRA_ACORDO.map((v) => ({ valor: v, rotulo: t(`regrasAcordo.tipos.${v}`) }));
const opcoes = (lista: readonly string[], grupo: string) =>
  lista.map((v) => ({ valor: v, rotulo: t(`regrasAcordo.${grupo}.${v}`) }));

// ── Lista do tipo escolhido ───────────────────────────────────────────────────────────────────────────
interface LinhaRegra {
  readonly id: number;
  readonly versao: number;
  readonly texto: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly vigente: boolean;
  readonly editavel: boolean;
}
const pct = (v: number | null) => (v === null ? '' : `${v}%`);
const rs = (v: number | null) => (v === null ? '' : `R$ ${v.toFixed(2)}`);
const junta = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(' · ');

function linhas(r: RegrasAcordo, tp: TipoRegraAcordo): LinhaRegra[] {
  const v = (x: { id: number; versao: number; inicio: string; fim: string | null; vigente: boolean }) => ({
    id: x.id,
    versao: x.versao,
    inicio: x.inicio,
    fim: x.fim,
    vigente: x.vigente,
    editavel: true,
  });
  switch (tp) {
    case 'percentual':
      return r.percentuais.map((x) => ({
        ...v(x),
        texto: junta(
          t(`regrasAcordo.componentes.${x.componente}`),
          pct(x.percentual),
          rs(x.valorFixo),
          x.item ?? x.grupo,
          x.plano,
          x.funcaoEquipe,
          x.tipoConta,
          x.tipoPaciente !== 'todos' && t(`regrasAcordo.tiposPaciente.${x.tipoPaciente}`),
        ),
      }));
    case 'desconto':
      return r.descontosGrupo.map((x) => ({
        ...v(x),
        texto: junta(
          x.grupo,
          x.subgrupo,
          x.desconto > 0 ? `-${x.desconto}%` : `+${x.acrescimo}%`,
          x.regimes.map((g) => t(`regrasAcordo.regimes.${g}`)).join(', '),
        ),
      }));
    case 'via':
      return r.viasAcesso.map((x) => ({
        ...v(x),
        // A regra padrão de todas as fontes não se encerra de dentro de um acordo.
        editavel: !x.padraoDeTodas,
        texto: junta(
          x.descricao,
          x.via,
          `${x.ordem}º`,
          pct(x.percentual),
          x.item,
          x.padraoDeTodas && t('regrasAcordo.padraoDeTodas'),
        ),
      }));
    case 'isento':
      return r.isentos.map((x) => ({
        ...v(x),
        texto: junta(x.item ?? x.grupo, x.plano, x.regime, x.motivo),
      }));
    case 'teto':
      return r.tetos.map((x) => ({
        ...v(x),
        texto: junta(
          t(`regrasAcordo.abrangencias.${x.abrangencia}`),
          x.item ?? x.grupo,
          x.plano,
          rs(x.valorTeto),
          x.ocorrenciasMaximas !== null && `${x.ocorrenciasMaximas}x`,
          t(`regrasAcordo.acoes.${x.acao}`),
          x.excedenteFonte,
          x.excedentePlano,
        ),
      }));
    case 'alto-custo':
      return r.altoCusto.map((x) => ({
        ...v(x),
        texto: junta(
          x.item ?? x.grupo,
          x.plano,
          t(`regrasAcordo.regrasAltoCusto.${x.regra}`),
          rs(x.valorBase),
          rs(x.valorNegociado),
        ),
      }));
  }
}
const lista = computed(() => (consulta.data.value ? linhas(consulta.data.value, tipo.value) : []));

// ── Formulário (um modelo só; a entrada sai pelo tipo) ──────────────────────────────────────────────
const f = reactive({
  tabelaId: '',
  componente: 'honorario',
  tipoPaciente: 'todos',
  percentual: '',
  valorFixo: '',
  alvo: 'item' as 'item' | 'grupo',
  itemId: '',
  grupoId: '',
  planoId: '',
  sentido: 'desconto' as 'desconto' | 'acrescimo',
  regimes: [...REGIMES_DESCONTO] as string[],
  sobre: [...PARCELAS_DESCONTO] as string[],
  descricao: '',
  viaId: '',
  ordem: '2',
  criterio: 'maior_valor',
  motivo: '',
  abrangencia: 'conta',
  valorTeto: '',
  ocorrenciasMaximas: '',
  acao: 'alertar',
  excedenteFonteId: '',
  excedentePlanoId: '',
  regra: 'preco_negociado',
  valorBase: '',
  valorNegociado: '',
  vigenciaInicio: hoje,
  vigenciaFim: '',
});
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));
const int = (v: string): number | null => (v.trim() === '' ? null : Math.trunc(Number(v)));

const entrada = computed<Record<string, unknown>>(() => {
  const vig = { vigenciaInicio: f.vigenciaInicio, vigenciaFim: f.vigenciaFim || null };
  const alvo = {
    itemId: f.alvo === 'item' ? int(f.itemId) : null,
    grupoId: f.alvo === 'grupo' ? int(f.grupoId) : null,
  };
  switch (tipo.value) {
    case 'percentual':
      return {
        ...vig,
        tabelaId: int(f.tabelaId),
        componente: f.componente,
        tipoPaciente: f.tipoPaciente,
        planoId: int(f.planoId),
        itemId: int(f.itemId),
        grupoId: int(f.grupoId),
        percentual: num(f.percentual),
        valorFixo: num(f.valorFixo),
        quantidadeFixa: null,
      };
    case 'desconto': {
      const p = num(f.percentual) ?? 0;
      return {
        ...vig,
        grupoId: int(f.grupoId),
        desconto: f.sentido === 'desconto' ? p : 0,
        acrescimo: f.sentido === 'acrescimo' ? p : 0,
        regimes: f.regimes,
        sobre: f.sobre,
      };
    }
    case 'via':
      return {
        ...vig,
        descricao: f.descricao,
        viaId: int(f.viaId),
        itemId: int(f.itemId),
        ordem: int(f.ordem) ?? 0,
        percentual: num(f.percentual) ?? -1,
        criterio: f.criterio,
      };
    case 'isento':
      return { ...vig, ...alvo, planoId: int(f.planoId), motivo: f.motivo };
    case 'teto':
      return {
        ...vig,
        planoId: int(f.planoId),
        abrangencia: f.abrangencia,
        itemId: f.abrangencia === 'item' ? int(f.itemId) : null,
        grupoId: f.abrangencia === 'grupo' ? int(f.grupoId) : null,
        valorTeto: num(f.valorTeto),
        quantidadeMaxima: null,
        ocorrenciasMaximas: int(f.ocorrenciasMaximas),
        acao: f.acao,
        excedenteFonteId: f.acao === 'transferir_excedente' ? int(f.excedenteFonteId) : null,
        excedentePlanoId: f.acao === 'transferir_excedente' ? int(f.excedentePlanoId) : null,
      };
    default:
      return {
        ...vig,
        ...alvo,
        planoId: int(f.planoId),
        regra: f.regra,
        valorBase: num(f.valorBase),
        valorNegociado: f.regra === 'preco_negociado' ? num(f.valorNegociado) : null,
      };
  }
});

/** Validação na hora, pelas mesmas regras do domínio que a API aplica antes de gravar. */
const erros = computed<ErrosRegra>(() => {
  const e = entrada.value as never;
  switch (tipo.value) {
    case 'percentual':
      return validarPercentualCobranca(e);
    case 'desconto':
      return validarDescontoGrupo(e);
    case 'via':
      return validarViaAcesso(e);
    case 'isento':
      return validarIsento(e);
    case 'teto':
      return validarTeto({ ...(entrada.value as object), fonteId: props.codigo } as never);
    default:
      return validarAltoCusto(e);
  }
});
/** Campos de texto e número do tipo escolhido (as opções e marcações ficam nos combos e caixas acima). */
const camposVisiveis = computed(() => {
  const tp: string = tipo.value;
  return [
    tp === 'percentual' && 'tabelaId',
    tp === 'via' && 'descricao',
    tp === 'via' && 'viaId',
    tp === 'via' && 'ordem',
    ['percentual', 'desconto', 'via'].includes(tp) && 'percentual',
    tp === 'percentual' && 'valorFixo',
    (tp === 'percentual' ||
      tp === 'via' ||
      (tp === 'teto' && f.abrangencia === 'item') ||
      ((tp === 'isento' || tp === 'alto-custo') && f.alvo === 'item')) &&
      'itemId',
    (tp === 'percentual' ||
      tp === 'desconto' ||
      (tp === 'teto' && f.abrangencia === 'grupo') ||
      ((tp === 'isento' || tp === 'alto-custo') && f.alvo === 'grupo')) &&
      'grupoId',
    ['percentual', 'isento', 'teto', 'alto-custo'].includes(tp) && 'planoId',
    tp === 'isento' && 'motivo',
    tp === 'teto' && 'valorTeto',
    tp === 'teto' && 'ocorrenciasMaximas',
    tp === 'teto' && f.acao === 'transferir_excedente' && 'excedenteFonteId',
    tp === 'teto' && f.acao === 'transferir_excedente' && 'excedentePlanoId',
    tp === 'alto-custo' && 'valorBase',
    tp === 'alto-custo' && f.regra === 'preco_negociado' && 'valorNegociado',
    'vigenciaInicio',
    'vigenciaFim',
  ].filter((x): x is keyof typeof f & string => typeof x === 'string');
});
/** Erros sem campo de digitação próprio (combos, marcações): aparecem juntos, depois de tentar gravar. */
const errosSoltos = computed(() =>
  tentou.value
    ? Object.entries(erros.value)
        .filter(([c]) => c !== 'regimes' && !(camposVisiveis.value as string[]).includes(c))
        .map(([, m]) => m)
    : [],
);
const tocados = reactive(new Set<string>());
const valorCampo = (c: string) => String((f as unknown as Record<string, unknown>)[c] ?? '');
function definirCampo(c: string, v: string) {
  (f as unknown as Record<string, unknown>)[c] = v;
}
const erroDe = (c: string) => (tocados.has(c) || tentou.value ? erros.value[c] : undefined);
const tentou = ref(false);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

async function recarregar() {
  await cliente.invalidateQueries({ queryKey: ['convenio', 'regras-acordo', props.codigo] });
}

async function incluir(): Promise<void> {
  tentou.value = true;
  erro.value = null;
  mensagem.value = null;
  if (Object.keys(erros.value).length) return;
  ocupado.value = true;
  try {
    const r = await incluirRegraAcordo(props.codigo, tipo.value, entrada.value);
    mensagem.value = t('regrasAcordo.incluida', { n: Number(r['encerradas'] ?? 0) });
    tentou.value = false;
    tocados.clear();
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const fimEncerrar = reactive<Record<number, string>>({});
async function encerrar(l: LinhaRegra): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await encerrarRegraAcordo(props.codigo, tipo.value, l.id, {
      versao: l.versao,
      vigenciaFim: fimEncerrar[l.id] || hoje,
    });
    mensagem.value = t('regrasAcordo.encerradaOk');
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const podeEncerrar = (l: LinhaRegra) => props.podeEditar && l.editavel && (l.fim === null || l.fim >= hoje);

function marcar(lista: string[], v: string, ligado: boolean) {
  const i = lista.indexOf(v);
  if (ligado && i < 0) lista.push(v);
  if (!ligado && i >= 0) lista.splice(i, 1);
}
</script>

<template>
  <section class="regras" aria-labelledby="regras-acordo-titulo" data-testid="regras-acordo">
    <h2 id="regras-acordo-titulo">{{ t('regrasAcordo.titulo') }}</h2>
    <p>{{ t('regrasAcordo.texto') }}</p>
    <SanteSelecao
      v-model="tipo"
      :rotulo="t('regrasAcordo.tipo')"
      :opcoes="opcoesTipo"
      data-testid="regras-tipo"
    />
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-if="consulta.data.value && lista.length === 0" data-testid="regras-vazio">
      {{ t('regrasAcordo.nenhuma') }}
    </p>
    <table v-else-if="consulta.data.value" data-testid="regras-lista">
      <caption>
        {{
          t('regrasAcordo.naData', { data: consulta.data.value.data })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('regrasAcordo.regra') }}</th>
          <th scope="col">{{ t('regrasAcordo.vigencia') }}</th>
          <th v-if="podeEditar" scope="col">{{ t('regrasAcordo.encerrar') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in lista" :key="l.id" :data-testid="`regra-${l.id}`">
          <th scope="row">{{ l.texto }}</th>
          <td>
            {{ l.inicio }} — {{ l.fim ?? t('regrasAcordo.semFim') }}
            <strong v-if="l.vigente">{{ t('regrasAcordo.vigente') }}</strong>
            <span v-else>{{ t('regrasAcordo.encerrada') }}</span>
          </td>
          <td v-if="podeEditar">
            <template v-if="podeEncerrar(l)">
              <label :for="`encerrar-${l.id}`">{{ t('regrasAcordo.encerrarEm') }}</label>
              <input
                :id="`encerrar-${l.id}`"
                v-model="fimEncerrar[l.id]"
                type="date"
                :min="hoje"
                :placeholder="hoje"
                :data-testid="`encerrar-data-${l.id}`"
              />
              <SanteBotao
                :rotulo="t('regrasAcordo.encerrar')"
                variante="secundario"
                :desabilitado="ocupado"
                :data-testid="`encerrar-${l.id}`"
                @acionar="encerrar(l)"
              />
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="!podeEditar" data-testid="regras-somente-consulta">{{ t('regrasAcordo.somenteConsulta') }}</p>
    <form v-else class="formulario" data-testid="regras-form" novalidate @submit.prevent="incluir">
      <h3>{{ t('regrasAcordo.incluir') }}: {{ t(`regrasAcordo.tipos.${tipo}`) }}</h3>

      <template v-if="tipo === 'percentual'">
        <SanteSelecao
          v-model="f.componente"
          :rotulo="t('regrasAcordo.campos.componente')"
          :opcoes="opcoes(COMPONENTES_PERCENTUAL, 'componentes')"
          data-testid="regra-componente"
        />
        <SanteSelecao
          v-model="f.tipoPaciente"
          :rotulo="t('regrasAcordo.campos.tipoPaciente')"
          :opcoes="opcoes(TIPOS_PACIENTE_REGRA, 'tiposPaciente')"
          data-testid="regra-tipo-paciente"
        />
      </template>
      <template v-if="tipo === 'desconto'">
        <SanteSelecao
          v-model="f.sentido"
          :rotulo="t('regrasAcordo.campos.sentido')"
          :opcoes="[
            { valor: 'desconto', rotulo: t('regrasAcordo.campos.desconto') },
            { valor: 'acrescimo', rotulo: t('regrasAcordo.campos.acrescimo') },
          ]"
          data-testid="regra-sentido"
        />
      </template>
      <template v-if="tipo === 'isento' || tipo === 'alto-custo'">
        <SanteSelecao
          v-model="f.alvo"
          :rotulo="t('regrasAcordo.campos.alvo')"
          :opcoes="[
            { valor: 'item', rotulo: t('regrasAcordo.campos.alvoItem') },
            { valor: 'grupo', rotulo: t('regrasAcordo.campos.alvoGrupo') },
          ]"
          data-testid="regra-alvo"
        />
      </template>
      <template v-if="tipo === 'via'">
        <SanteSelecao
          v-model="f.criterio"
          :rotulo="t('regrasAcordo.campos.criterio')"
          :opcoes="opcoes(CRITERIOS_ORDEM_VIA, 'criterios')"
          data-testid="regra-criterio"
        />
      </template>
      <template v-if="tipo === 'teto'">
        <SanteSelecao
          v-model="f.abrangencia"
          :rotulo="t('regrasAcordo.campos.abrangencia')"
          :opcoes="opcoes(ABRANGENCIAS_TETO, 'abrangencias')"
          data-testid="regra-abrangencia"
        />
        <SanteSelecao
          v-model="f.acao"
          :rotulo="t('regrasAcordo.campos.acao')"
          :opcoes="opcoes(ACOES_TETO, 'acoes')"
          data-testid="regra-acao"
        />
      </template>
      <template v-if="tipo === 'alto-custo'">
        <SanteSelecao
          v-model="f.regra"
          :rotulo="t('regrasAcordo.campos.regra')"
          :opcoes="opcoes(REGRAS_ALTO_CUSTO, 'regrasAltoCusto')"
          data-testid="regra-alto-custo"
        />
      </template>

      <fieldset v-if="tipo === 'desconto'">
        <legend>{{ t('regrasAcordo.campos.regimes') }}</legend>
        <label v-for="g in REGIMES_DESCONTO" :key="g">
          <input
            type="checkbox"
            :checked="f.regimes.includes(g)"
            :data-testid="`regra-regime-${g}`"
            @change="marcar(f.regimes, g, ($event.target as HTMLInputElement).checked)"
          />
          {{ t(`regrasAcordo.regimes.${g}`) }}
        </label>
        <p v-if="erroDe('regimes')" class="erro" role="alert">{{ erroDe('regimes') }}</p>
      </fieldset>
      <fieldset v-if="tipo === 'desconto'">
        <legend>{{ t('regrasAcordo.campos.sobre') }}</legend>
        <label v-for="s in PARCELAS_DESCONTO" :key="s">
          <input
            type="checkbox"
            :checked="f.sobre.includes(s)"
            :data-testid="`regra-sobre-${s}`"
            @change="marcar(f.sobre, s, ($event.target as HTMLInputElement).checked)"
          />
          {{ t(`regrasAcordo.parcelas.${s}`) }}
        </label>
      </fieldset>

      <template v-for="c in camposVisiveis" :key="c">
        <div class="campo">
          <label :for="`regra-${c}`">{{ t(`regrasAcordo.campos.${c}`) }}</label>
          <input
            :id="`regra-${c}`"
            :value="valorCampo(c)"
            :type="
              c.startsWith('vigencia') ? 'date' : c === 'descricao' || c === 'motivo' ? 'text' : 'number'
            "
            :aria-invalid="!!erroDe(c)"
            :data-testid="`regra-campo-${c}`"
            @input="definirCampo(c, ($event.target as HTMLInputElement).value)"
            @blur="tocados.add(c)"
          />
          <p v-if="erroDe(c)" class="erro" role="alert" :data-testid="`regra-erro-${c}`">{{ erroDe(c) }}</p>
        </div>
      </template>
      <p v-for="m in errosSoltos" :key="m" class="erro" role="alert">{{ m }}</p>
      <SanteBotao
        tipo="submit"
        :rotulo="t('regrasAcordo.incluir')"
        :desabilitado="ocupado"
        data-testid="regra-incluir"
      />
    </form>
    <p v-if="mensagem" role="status" data-testid="regras-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.regras {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.erro {
  color: var(--sgh-alerta);
  margin: 0;
}
</style>
