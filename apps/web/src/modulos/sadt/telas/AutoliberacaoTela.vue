<script setup lang="ts">
// Autoliberação de resultados (F8, 05-SADT linha 11): `/sadt/autoliberacao`. A primeira aba é a fila de conferência do
// responsável técnico, agrupada por paciente (os críticos primeiro), com os motivos da retenção e a liberação num
// clique. As outras abas são o cadastro: regras por exame (a faixa do analito é obrigatória para liberar; delta, idade e
// sexo opcionais, conferidos na hora), limites de delta check do estabelecimento e substâncias interferentes
// (medicamento pelo princípio ativo ou condição da amostra). Desativar nunca apaga.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarPrincipios,
  type CondicaoNova,
  desativarCadastroAutoliberacao,
  incluirInterferente,
  incluirLimiteDelta,
  incluirRegraAutoliberacao,
  lerCadastroAutoliberacao,
  lerFilaConferencia,
  liberarRetido,
  type RetidoNaFila,
} from '../api-autoliberacao.js';
import { codigoDaRecusa, novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

type Aba = 'fila' | 'regras' | 'deltas' | 'interferentes';
const { t, te } = useI18n();
const cliente = useQueryClient();
const aba = ref<Aba>('fila');
const fila = useQuery({ queryKey: ['sadt', 'autoliberacao', 'fila'], queryFn: lerFilaConferencia });
const cadastro = useQuery({
  queryKey: ['sadt', 'autoliberacao', 'cadastro'],
  queryFn: lerCadastroAutoliberacao,
  enabled: computed(() => aba.value !== 'fila'),
});
// Dia local do posto (nunca o UTC: à noite o UTC já é o dia seguinte e a regra nasceria fora de vigência).
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const mensagem = ref('');
const erro = ref<unknown>(null);
const recusaPropria = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`sadt.autoliberacao.recusas.${c}`) ? t(`sadt.autoliberacao.recusas.${c}`) : null;
});
async function executar(acao: () => Promise<unknown>, ok: string) {
  mensagem.value = '';
  erro.value = null;
  try {
    await acao();
    mensagem.value = ok;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'autoliberacao'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Fila: visão por paciente ───────────────────────────────────────────────────────────────────────────────
const filtro = ref('');
const porPaciente = computed(() => {
  const termo = filtro.value.trim().toLowerCase();
  const grupos = new Map<number, { nome: string; itens: RetidoNaFila[] }>();
  for (const r of fila.data.value ?? []) {
    if (termo && !r.pacienteNome.toLowerCase().includes(termo)) continue;
    const g = grupos.get(r.paciente) ?? { nome: r.pacienteNome, itens: [] };
    g.itens.push(r);
    grupos.set(r.paciente, g);
  }
  return [...grupos.entries()].map(([id, g]) => ({ id, ...g }));
});
const motivo = (m: string) =>
  te(`sadt.autoliberacao.motivos.${m}`) ? t(`sadt.autoliberacao.motivos.${m}`) : m;
const liberar = (r: RetidoNaFila) =>
  executar(
    () => liberarRetido(r.exameItem, novaChave('autolib.liberar')),
    t('sadt.autoliberacao.fila.liberado'),
  );

// ── Cadastro ─────────────────────────────────────────────────────────────────────────────────────────────────
const de = (xs: readonly { id: number; nome: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const opcoes = computed(() => cadastro.data.value?.opcoes);
const exames = computed(() => de(opcoes.value?.exames, t('sadt.autoliberacao.escolha')));
const setores = computed(() => de(opcoes.value?.setores, t('sadt.autoliberacao.todos')));
const analitosDo = (exame: string) =>
  de(
    opcoes.value?.analitos.filter((a) => String(a.exame) === exame),
    t('sadt.autoliberacao.escolha'),
  );
const todosAnalitos = computed(() => {
  const vistos = new Map<number, string>();
  for (const a of opcoes.value?.analitos ?? []) vistos.set(a.id, a.nome);
  return de(
    [...vistos.entries()].map(([id, nome]) => ({ id, nome })),
    t('sadt.autoliberacao.escolha'),
  );
});
const lista = <K extends string>(chaves: readonly K[], prefixo: string) =>
  chaves.map((k) => ({ valor: k, rotulo: t(`sadt.autoliberacao.${prefixo}.${k}`) }));
const acoesRegra = computed(() => lista(['liberar', 'reter'] as const, 'acoes'));
const acoesDelta = computed(() =>
  lista(['reter_revisao', 'bloquear_autoliberacao', 'alertar'] as const, 'acoesDelta'),
);
const tiposDelta = computed(() => lista(['percentual', 'absoluta'] as const, 'tiposDelta'));
const efeitos = computed(() => lista(['variavel', 'aumenta', 'diminui', 'invalida'] as const, 'efeitos'));
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const nomeAnalito = (id: number | null) =>
  id === null ? '' : (opcoes.value?.analitos.find((a) => a.id === id)?.nome ?? `#${id}`);

const regra = ref({
  codigo: '',
  descricao: '',
  exame: '',
  setor: '',
  acao: 'liberar' as 'liberar' | 'reter',
  prioridade: '1',
  inicio: '',
  analito: '',
  minimo: '',
  maximo: '',
  delta: '',
  janela: '72',
  idadeMin: '',
  idadeMax: '',
  sexo: '',
});
watch(
  () => regra.value.exame,
  () => (regra.value.analito = ''),
);
const faixaOk = (a: string, b: string) => {
  const x = num(a);
  const y = num(b);
  return x === null || y === null || x <= y;
};
const regraErro = computed(() =>
  faixaOk(regra.value.minimo, regra.value.maximo) && faixaOk(regra.value.idadeMin, regra.value.idadeMax)
    ? ''
    : t('sadt.autoliberacao.faixaInvalida'),
);
const regraValida = computed(() => {
  const r = regra.value;
  const temFaixa = r.analito !== '' && (num(r.minimo) !== null || num(r.maximo) !== null);
  return (
    r.codigo.trim().length >= 2 &&
    r.descricao.trim().length >= 3 &&
    r.exame !== '' &&
    !regraErro.value &&
    (r.acao === 'reter' || temFaixa)
  );
});
function condicoesDaRegra(): CondicaoNova[] {
  const r = regra.value;
  const base = {
    operador: null,
    valor: null,
    minimo: null,
    maximo: null,
    deltaPercentual: null,
    deltaJanelaHoras: null,
  };
  const out: CondicaoNova[] = [];
  if (r.analito !== '' && (num(r.minimo) !== null || num(r.maximo) !== null))
    out.push({
      ...base,
      tipo: 'faixa',
      analito: Number(r.analito),
      operador: 'entre',
      minimo: num(r.minimo),
      maximo: num(r.maximo),
    });
  if (r.analito !== '' && num(r.delta) !== null)
    out.push({
      ...base,
      tipo: 'delta',
      analito: Number(r.analito),
      deltaPercentual: num(r.delta),
      deltaJanelaHoras: num(r.janela),
    });
  if (num(r.idadeMin) !== null || num(r.idadeMax) !== null)
    out.push({
      ...base,
      tipo: 'idade',
      analito: null,
      operador: 'entre',
      minimo: num(r.idadeMin),
      maximo: num(r.idadeMax),
    });
  if (r.sexo.trim()) out.push({ ...base, tipo: 'sexo', analito: null, valor: r.sexo.trim().toUpperCase() });
  return out;
}
const gravarRegra = () =>
  executar(
    () =>
      incluirRegraAutoliberacao(
        {
          codigo: regra.value.codigo.trim(),
          descricao: regra.value.descricao.trim(),
          exame: Number(regra.value.exame),
          setor: regra.value.setor === '' ? null : Number(regra.value.setor),
          acao: regra.value.acao,
          prioridade: Number(regra.value.prioridade || 0),
          vigenciaInicio: regra.value.inicio || hoje(),
          vigenciaFim: null,
          condicoes: condicoesDaRegra(),
        },
        novaChave('autolib.regra'),
      ),
    t('sadt.autoliberacao.gravado'),
  );

const delta = ref({
  analito: '',
  tipo: 'percentual' as 'percentual' | 'absoluta',
  variacao: '',
  janela: '72',
  acao: 'reter_revisao' as 'alertar' | 'reter_revisao' | 'bloquear_autoliberacao',
  inicio: '',
});
const deltaValido = computed(
  () =>
    delta.value.analito !== '' && (num(delta.value.variacao) ?? 0) > 0 && (num(delta.value.janela) ?? 0) > 0,
);
const gravarDelta = () =>
  executar(
    () =>
      incluirLimiteDelta(
        {
          analito: Number(delta.value.analito),
          tipo: delta.value.tipo,
          variacaoMaxima: num(delta.value.variacao)!,
          janelaHoras: Math.round(num(delta.value.janela)!),
          acao: delta.value.acao,
          vigenciaInicio: delta.value.inicio || hoje(),
        },
        novaChave('autolib.delta'),
      ),
    t('sadt.autoliberacao.gravado'),
  );

const interf = ref({
  exame: '',
  analito: '',
  substancia: '',
  busca: '',
  principio: '',
  efeito: 'variavel' as 'aumenta' | 'diminui' | 'variavel' | 'invalida',
  mensagem: '',
  bloqueia: true,
});
const principios = ref<{ id: number; nome: string }[]>([]);
watch(
  () => interf.value.busca,
  async (b) => {
    principios.value = b.trim().length >= 3 ? await buscarPrincipios(b).catch(() => []) : [];
  },
);
const opcoesPrincipio = computed(() => de(principios.value, t('sadt.autoliberacao.todos')));
const interfValido = computed(() => interf.value.exame !== '' && interf.value.substancia.trim().length >= 2);
const gravarInterferente = () =>
  executar(
    () =>
      incluirInterferente(
        {
          exame: Number(interf.value.exame),
          analito: interf.value.analito === '' ? null : Number(interf.value.analito),
          principioAtivo: interf.value.principio === '' ? null : Number(interf.value.principio),
          substancia: interf.value.substancia.trim(),
          efeito: interf.value.efeito,
          mensagem: interf.value.mensagem.trim() || null,
          bloqueia: interf.value.bloqueia,
        },
        novaChave('autolib.interferente'),
      ),
    t('sadt.autoliberacao.gravado'),
  );
const desativar = (tipo: 'regras' | 'limites-delta' | 'interferentes', id: number) =>
  executar(
    () => desativarCadastroAutoliberacao(tipo, id, novaChave('autolib.desativar')),
    t('sadt.autoliberacao.desativado'),
  );
const resumoCondicao = (c: {
  tipo: string;
  analito: number | null;
  minimo: number | null;
  maximo: number | null;
  deltaPercentual: number | null;
  valor: string | null;
}) =>
  c.tipo === 'delta'
    ? `${nomeAnalito(c.analito)} Δ ≤ ${c.deltaPercentual}%`
    : c.tipo === 'sexo'
      ? `${t('sadt.autoliberacao.campos.sexo')}: ${c.valor ?? ''}`
      : `${c.tipo === 'idade' ? t('sadt.autoliberacao.campos.idadeMinima') : nomeAnalito(c.analito)} ${c.minimo ?? '…'}–${c.maximo ?? '…'}`;
</script>

<template>
  <section class="autolib" data-testid="autoliberacao">
    <h1>{{ t('sadt.autoliberacao.titulo') }}</h1>
    <p>{{ t('sadt.autoliberacao.explicacao') }}</p>
    <div class="linha" role="group" :aria-label="t('sadt.autoliberacao.titulo')">
      <SanteBotao
        v-for="a in ['fila', 'regras', 'deltas', 'interferentes'] as const"
        :key="a"
        :rotulo="t(`sadt.autoliberacao.abas.${a}`)"
        :variante="aba === a ? 'primario' : 'secundario'"
        :data-testid="`autolib-aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="autolib-mensagem">{{ mensagem }}</p>
    <p v-if="recusaPropria" role="alert" data-testid="autolib-recusa">{{ recusaPropria }}</p>
    <ErroSadt v-else-if="erro" :erro="erro" />

    <div v-if="aba === 'fila'" data-testid="autolib-fila">
      <label
        >{{ t('sadt.autoliberacao.fila.filtrar') }}<input v-model="filtro" data-testid="autolib-filtro"
      /></label>
      <ErroSadt v-if="fila.error.value" :erro="fila.error.value" />
      <p v-else-if="!porPaciente.length">{{ t('sadt.autoliberacao.fila.vazia') }}</p>
      <article v-for="g in porPaciente" :key="g.id" class="paciente" data-testid="autolib-paciente">
        <h2>{{ g.nome }}</h2>
        <ul>
          <li v-for="r in g.itens" :key="r.exameItem" data-testid="autolib-retido">
            <strong>{{ r.exame }}</strong> · {{ r.setor }}
            <span v-if="r.critico"> · {{ t('sadt.autoliberacao.fila.critico') }}</span>
            ·
            <span v-for="m in r.motivos" :key="m" class="motivo" data-testid="autolib-motivo">{{
              motivo(m)
            }}</span>
            <span v-if="r.interferentes.length"> ({{ r.interferentes.join(', ') }})</span>
            <SanteBotao
              :rotulo="t('sadt.autoliberacao.fila.liberar')"
              data-testid="autolib-liberar"
              @acionar="liberar(r)"
            />
          </li>
        </ul>
      </article>
    </div>

    <fieldset v-else-if="aba === 'regras'" data-testid="autolib-regras">
      <legend>{{ t('sadt.autoliberacao.abas.regras') }}</legend>
      <div class="linha">
        <label
          >{{ t('sadt.autoliberacao.campos.codigo')
          }}<input v-model="regra.codigo" maxlength="30" data-testid="regra-codigo"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.descricao')
          }}<input v-model="regra.descricao" maxlength="150" data-testid="regra-descricao"
        /></label>
        <SanteSelecao
          v-model="regra.exame"
          :rotulo="t('sadt.autoliberacao.campos.exame')"
          :opcoes="exames"
          data-testid="regra-exame"
        />
        <SanteSelecao
          v-model="regra.setor"
          :rotulo="t('sadt.autoliberacao.campos.setor')"
          :opcoes="setores"
        />
        <SanteSelecao
          v-model="regra.acao"
          :rotulo="t('sadt.autoliberacao.campos.acao')"
          :opcoes="acoesRegra"
          data-testid="regra-acao"
        />
        <label
          >{{ t('sadt.autoliberacao.campos.prioridade')
          }}<input v-model="regra.prioridade" inputmode="numeric"
        /></label>
        <label>{{ t('sadt.autoliberacao.campos.inicio') }}<input v-model="regra.inicio" type="date" /></label>
      </div>
      <div class="linha">
        <SanteSelecao
          v-model="regra.analito"
          :rotulo="t('sadt.autoliberacao.campos.analito')"
          :opcoes="analitosDo(regra.exame)"
          data-testid="regra-analito"
        />
        <label
          >{{ t('sadt.autoliberacao.campos.minimo')
          }}<input v-model="regra.minimo" inputmode="decimal" data-testid="regra-minimo"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.maximo')
          }}<input v-model="regra.maximo" inputmode="decimal" data-testid="regra-maximo"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.deltaPercentual')
          }}<input v-model="regra.delta" inputmode="decimal" data-testid="regra-delta"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.janela') }}<input v-model="regra.janela" inputmode="numeric"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.idadeMinima')
          }}<input v-model="regra.idadeMin" inputmode="numeric"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.idadeMaxima')
          }}<input v-model="regra.idadeMax" inputmode="numeric"
        /></label>
        <label>{{ t('sadt.autoliberacao.campos.sexo') }}<input v-model="regra.sexo" maxlength="1" /></label>
        <SanteBotao
          :rotulo="t('sadt.autoliberacao.incluir')"
          :desabilitado="!regraValida"
          data-testid="regra-incluir"
          @acionar="gravarRegra"
        />
      </div>
      <p v-if="regraErro" role="alert" data-testid="regra-erro">{{ regraErro }}</p>
      <p v-if="!(cadastro.data.value?.regras ?? []).length">{{ t('sadt.autoliberacao.nenhum') }}</p>
      <ul>
        <li
          v-for="r in cadastro.data.value?.regras ?? []"
          :key="r.id"
          :class="{ inativa: !r.ativo }"
          data-testid="regra-item"
        >
          {{ r.codigo }} · {{ r.exameNome }} · {{ t(`sadt.autoliberacao.acoes.${r.acao}`) }} ·
          {{ r.prioridade }} ·
          {{ r.condicoes.map(resumoCondicao).join('; ') }}
          <span v-if="!r.ativo"> · {{ t('sadt.autoliberacao.inativa') }}</span>
          <SanteBotao
            v-else
            variante="secundario"
            :rotulo="t('sadt.autoliberacao.desativar')"
            @acionar="desativar('regras', r.id)"
          />
        </li>
      </ul>
    </fieldset>

    <fieldset v-else-if="aba === 'deltas'" data-testid="autolib-deltas">
      <legend>{{ t('sadt.autoliberacao.abas.deltas') }}</legend>
      <div class="linha">
        <SanteSelecao
          v-model="delta.analito"
          :rotulo="t('sadt.autoliberacao.campos.analito')"
          :opcoes="todosAnalitos"
          data-testid="delta-analito"
        />
        <SanteSelecao
          v-model="delta.tipo"
          :rotulo="t('sadt.autoliberacao.campos.tipo')"
          :opcoes="tiposDelta"
        />
        <label
          >{{ t('sadt.autoliberacao.campos.variacao')
          }}<input v-model="delta.variacao" inputmode="decimal" data-testid="delta-variacao"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.janela')
          }}<input v-model="delta.janela" inputmode="numeric" data-testid="delta-janela"
        /></label>
        <SanteSelecao
          v-model="delta.acao"
          :rotulo="t('sadt.autoliberacao.campos.acao')"
          :opcoes="acoesDelta"
        />
        <label>{{ t('sadt.autoliberacao.campos.inicio') }}<input v-model="delta.inicio" type="date" /></label>
        <SanteBotao
          :rotulo="t('sadt.autoliberacao.incluir')"
          :desabilitado="!deltaValido"
          data-testid="delta-incluir"
          @acionar="gravarDelta"
        />
      </div>
      <p v-if="!(cadastro.data.value?.limitesDelta ?? []).length">{{ t('sadt.autoliberacao.nenhum') }}</p>
      <ul>
        <li
          v-for="d in cadastro.data.value?.limitesDelta ?? []"
          :key="d.id"
          :class="{ inativa: !d.ativo }"
          data-testid="delta-item"
        >
          {{ d.analitoNome }} · {{ d.variacaoMaxima }}{{ d.tipo === 'percentual' ? '%' : '' }} ·
          {{ t('sadt.autoliberacao.horas', { n: d.janelaHoras }) }} ·
          {{ t(`sadt.autoliberacao.acoesDelta.${d.acao}`) }}
          <span v-if="!d.ativo"> · {{ t('sadt.autoliberacao.inativa') }}</span>
          <SanteBotao
            v-else
            variante="secundario"
            :rotulo="t('sadt.autoliberacao.desativar')"
            @acionar="desativar('limites-delta', d.id)"
          />
        </li>
      </ul>
    </fieldset>

    <fieldset v-else data-testid="autolib-interferentes">
      <legend>{{ t('sadt.autoliberacao.abas.interferentes') }}</legend>
      <div class="linha">
        <SanteSelecao
          v-model="interf.exame"
          :rotulo="t('sadt.autoliberacao.campos.exame')"
          :opcoes="exames"
          data-testid="interf-exame"
        />
        <SanteSelecao
          v-model="interf.analito"
          :rotulo="t('sadt.autoliberacao.campos.analito')"
          :opcoes="analitosDo(interf.exame)"
        />
        <label
          >{{ t('sadt.autoliberacao.campos.substancia')
          }}<input v-model="interf.substancia" maxlength="150" data-testid="interf-substancia"
        /></label>
        <label
          >{{ t('sadt.autoliberacao.campos.buscarPrincipio') }}<input v-model="interf.busca" maxlength="100"
        /></label>
        <SanteSelecao
          v-model="interf.principio"
          :rotulo="t('sadt.autoliberacao.campos.principio')"
          :opcoes="opcoesPrincipio"
        />
        <SanteSelecao
          v-model="interf.efeito"
          :rotulo="t('sadt.autoliberacao.campos.efeito')"
          :opcoes="efeitos"
        />
        <label
          >{{ t('sadt.autoliberacao.campos.mensagem') }}<input v-model="interf.mensagem" maxlength="500"
        /></label>
        <label
          ><input v-model="interf.bloqueia" type="checkbox" />
          {{ t('sadt.autoliberacao.campos.bloqueia') }}</label
        >
        <SanteBotao
          :rotulo="t('sadt.autoliberacao.incluir')"
          :desabilitado="!interfValido"
          data-testid="interf-incluir"
          @acionar="gravarInterferente"
        />
      </div>
      <p v-if="!(cadastro.data.value?.interferentes ?? []).length">{{ t('sadt.autoliberacao.nenhum') }}</p>
      <ul>
        <li
          v-for="i in cadastro.data.value?.interferentes ?? []"
          :key="i.id"
          :class="{ inativa: !i.ativo }"
          data-testid="interf-item"
        >
          {{ i.exameNome }} · {{ i.substancia
          }}<template v-if="i.principioNome"> ({{ i.principioNome }})</template> ·
          {{ t(`sadt.autoliberacao.efeitos.${i.efeito}`) }}
          <span v-if="!i.ativo"> · {{ t('sadt.autoliberacao.inativa') }}</span>
          <SanteBotao
            v-else
            variante="secundario"
            :rotulo="t('sadt.autoliberacao.desativar')"
            @acionar="desativar('interferentes', i.id)"
          />
        </li>
      </ul>
    </fieldset>
  </section>
</template>

<style scoped>
.autolib {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
label {
  display: grid;
  gap: 0.25rem;
}
.motivo + .motivo::before {
  content: ', ';
}
.inativa {
  opacity: 0.6;
}
</style>
