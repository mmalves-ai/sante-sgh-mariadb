<script setup lang="ts">
// Plano de cuidado e estratificação de risco do paciente (03-PEP L142), numa tela só por paciente: o plano novo em
// rascunho (início, fim previsto, risco e metas) ou a decisão de não criá-lo com justificativa; e cada plano com o risco
// (reestratificar avisa quando sobe para alto ou muito alto), os itens em hierarquia (problema > objetivo > intervenção,
// educação ou monitoramento) e os passos. Validação na hora: ativar só com risco e objetivo, fechar só sem item em
// aberto, desvio e cancelamento com justificativa. A regra final é do servidor; a recusa aparece como veio.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  gravarPlanoCuidado,
  lerPlanosCuidado,
  type ItemPlanoTela,
  type PlanoTela,
} from '../api-plano-cuidado.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'plano-cuidado', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerPlanosCuidado(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const aviso = ref(false);

const RISCOS = ['baixo', 'moderado', 'alto', 'muito_alto'] as const;
const TIPOS = ['problema', 'objetivo', 'intervencao', 'educacao', 'monitoramento'] as const;
const SUPERIORES: Record<string, readonly string[]> = {
  problema: [],
  objetivo: ['problema'],
  intervencao: ['objetivo', 'problema'],
  educacao: ['objetivo', 'problema'],
  monitoramento: ['objetivo', 'problema'],
};
const SEM = 'sem';
const hoje = () => new Date().toISOString().slice(0, 10);
const podeGravar = computed(() => pode('pep.evolucao.criar') && Boolean(d.value?.podeEscrever));
const opcoesRisco = computed(() => [
  { valor: SEM, rotulo: t('pep.planoCuidado.semRisco') },
  ...RISCOS.map((r) => ({ valor: r, rotulo: t(`pep.planoCuidado.riscos.${r}`) })),
]);
const opcoesTipo = computed(() => TIPOS.map((v) => ({ valor: v, rotulo: t(`pep.planoCuidado.tipos.${v}`) })));

const novo = reactive({ inicio: hoje(), fim: '', risco: SEM, metas: '', naoCriar: false, justificativa: '' });
const fimAntes = computed(() => Boolean(novo.fim) && novo.fim < novo.inicio);
const novoPronto = computed(() =>
  novo.naoCriar ? novo.justificativa.trim().length >= 10 : Boolean(novo.inicio) && !fimAntes.value,
);

async function gravar(corpo: Record<string, unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = '';
  aviso.value = false;
  try {
    const r = await gravarPlanoCuidado(corpo);
    ok.value = t('pep.planoCuidado.gravado');
    aviso.value = Boolean(r.resultado.avisar);
    depois?.();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}

const criar = () =>
  novo.naoCriar
    ? gravar({ acao: 'nao_criar', paciente: id.value, justificativa: novo.justificativa.trim() }, () =>
        Object.assign(novo, { naoCriar: false, justificativa: '' }),
      )
    : gravar(
        {
          acao: 'criar',
          paciente: id.value,
          inicio: novo.inicio,
          fimPrevisto: novo.fim || null,
          risco: novo.risco === SEM ? null : novo.risco,
          metas: novo.metas.trim() || null,
        },
        () => Object.assign(novo, { fim: '', risco: SEM, metas: '' }),
      );

/** Campos por plano (novo risco, motivo do cancelamento, item novo) e por item (justificativa do desvio). */
const campoPlano = reactive<
  Record<
    number,
    { risco: string; motivo: string; tipo: string; descricao: string; superior: string; prazo: string }
  >
>({});
const cp = (p: PlanoTela) =>
  (campoPlano[p.id] ??= {
    risco: p.risco ?? SEM,
    motivo: '',
    tipo: 'problema',
    descricao: '',
    superior: SEM,
    prazo: '',
  });
const campoItem = reactive<Record<number, string>>({});
const vigente = (p: PlanoTela) => p.situacao === 'rascunho' || p.situacao === 'ativo';
const aberto = (i: ItemPlanoTela) => i.situacao === 'pendente' || i.situacao === 'em_andamento';
const podeAtivar = (p: PlanoTela) =>
  p.situacao === 'rascunho' &&
  Boolean(p.risco) &&
  p.itens.some((i) => i.tipo === 'objetivo' && i.situacao !== 'cancelada' && i.situacao !== 'nao_realizada');
const podeFechar = (p: PlanoTela) => p.situacao === 'ativo' && !p.itens.some(aberto);
const opcoesSuperior = (p: PlanoTela) => [
  { valor: SEM, rotulo: t('pep.planoCuidado.semSuperior') },
  ...p.itens
    .filter((i) => (SUPERIORES[cp(p).tipo] ?? []).includes(i.tipo) && aberto(i))
    .map((i) => ({
      valor: String(i.id),
      rotulo: `${t(`pep.planoCuidado.tipos.${i.tipo}`)}: ${i.descricao}`,
    })),
];
const itemPronto = (p: PlanoTela) =>
  cp(p).descricao.trim().length >= 3 && (!cp(p).prazo || !p.inicio || cp(p).prazo >= p.inicio);
const recuo = (p: PlanoTela, i: ItemPlanoTela): number => {
  let n = 0;
  let s = i.superior;
  while (s !== null && n < 3) {
    n += 1;
    s = p.itens.find((x) => x.id === s)?.superior ?? null;
  }
  return n;
};

const passoPlano = (p: PlanoTela, acao: string, extra: Record<string, unknown> = {}) =>
  gravar({ acao, plano: p.id, versao: p.versao, ...extra });
const incluir = (p: PlanoTela) =>
  gravar(
    {
      acao: 'incluir_item',
      plano: p.id,
      tipo: cp(p).tipo,
      descricao: cp(p).descricao.trim(),
      superior: cp(p).superior === SEM ? null : Number(cp(p).superior),
      prazo: cp(p).prazo || null,
    },
    () => Object.assign(cp(p), { descricao: '', prazo: '', superior: SEM }),
  );
const passoItem = (i: ItemPlanoTela, passo: string) =>
  gravar({
    acao: 'passo_item',
    item: i.id,
    versao: i.versao,
    passo,
    ...(passo === 'cancelar' || passo === 'nao_realizar'
      ? { justificativa: (campoItem[i.id] ?? '').trim() }
      : {}),
  });
const desvioOk = (i: ItemPlanoTela) => (campoItem[i.id] ?? '').trim().length >= 5;
</script>

<template>
  <section class="plano" data-testid="plano-cuidado-tela">
    <h1>{{ t('pep.planoCuidado.titulo') }}</h1>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="plano-ok" />
    <SanteAlerta
      v-if="aviso"
      variante="aviso"
      :texto="t('pep.planoCuidado.aviso')"
      anunciar
      data-testid="plano-aviso"
    />
    <p v-if="!d && !dados.error.value">{{ t('pep.carregando') }}</p>
    <template v-else-if="d">
      <h2>{{ t('pep.planoCuidado.novo') }}</h2>
      <p v-if="pode('pep.evolucao.criar') && !d.podeEscrever">{{ t('pep.planoCuidado.semProfissional') }}</p>
      <form v-else-if="podeGravar" class="plano__linha" data-testid="plano-novo" @submit.prevent="criar">
        <label class="plano__marca">
          <input v-model="novo.naoCriar" type="checkbox" data-testid="plano-nao-criar" />
          {{ t('pep.planoCuidado.naoCriar') }}
        </label>
        <label v-if="novo.naoCriar" class="plano__largo">
          {{ t('pep.planoCuidado.justificativa') }}
          <textarea v-model="novo.justificativa" maxlength="500" rows="2" data-testid="plano-justificativa" />
        </label>
        <template v-else>
          <label>
            {{ t('pep.planoCuidado.inicio') }}
            <input v-model="novo.inicio" type="date" required data-testid="plano-inicio" />
          </label>
          <label>
            {{ t('pep.planoCuidado.fimPrevisto') }}
            <input v-model="novo.fim" type="date" :aria-invalid="fimAntes" data-testid="plano-fim" />
          </label>
          <SanteSelecao
            v-model="novo.risco"
            :rotulo="t('pep.planoCuidado.risco')"
            :opcoes="opcoesRisco"
            data-testid="plano-risco"
          />
          <label class="plano__largo">
            {{ t('pep.planoCuidado.metas') }}
            <textarea v-model="novo.metas" maxlength="4000" rows="2" data-testid="plano-metas" />
          </label>
          <SanteAlerta v-if="fimAntes" variante="alerta" :texto="t('pep.planoCuidado.fimAntes')" />
        </template>
        <SanteBotao
          tipo="submit"
          :desabilitado="!novoPronto"
          data-testid="plano-criar"
          :rotulo="novo.naoCriar ? t('pep.planoCuidado.registrarNaoCriacao') : t('pep.planoCuidado.criar')"
        />
      </form>

      <p v-if="d.planos.length === 0">{{ t('pep.planoCuidado.nenhum') }}</p>
      <article v-for="p in d.planos" :key="p.id" class="plano__item" :data-testid="`plano-${p.id}`">
        <h3>
          {{ t(`pep.planoCuidado.situacao.${p.situacao}`) }} ·
          <span :data-testid="`plano-risco-${p.id}`">{{
            p.risco ? t(`pep.planoCuidado.riscos.${p.risco}`) : t('pep.planoCuidado.semRisco')
          }}</span>
        </h3>
        <p class="plano__meta">
          {{ t('pep.planoCuidado.responsavel', { nome: p.responsavel ?? '' }) }} ·
          {{
            p.fimPrevisto
              ? t('pep.planoCuidado.periodo', { inicio: p.inicio, fim: p.fimPrevisto })
              : t('pep.planoCuidado.desde', { inicio: p.inicio })
          }}
        </p>
        <p v-if="p.metas" class="plano__corpo">{{ p.metas }}</p>
        <p v-if="p.justificativaNaoCriacao" class="plano__corpo">{{ p.justificativaNaoCriacao }}</p>
        <p v-if="p.observacao" class="plano__corpo">{{ p.observacao }}</p>

        <template v-if="p.situacao !== 'nao_criado'">
          <h4>{{ t('pep.planoCuidado.itens') }}</h4>
          <p v-if="p.itens.length === 0">{{ t('pep.planoCuidado.semItens') }}</p>
          <ul class="plano__itens">
            <li
              v-for="i in p.itens"
              :key="i.id"
              :style="{ marginInlineStart: `calc(${recuo(p, i)} * var(--sgh-espaco-4))` }"
              :data-testid="`plano-item-${i.id}`"
            >
              <strong>{{ t(`pep.planoCuidado.tipos.${i.tipo}`) }}</strong
              >: {{ i.descricao }} ·
              {{ t(`pep.planoCuidado.situacaoItem.${i.situacao}`) }}
              <span v-if="i.prazo"> · {{ t('pep.planoCuidado.ate', { prazo: i.prazo }) }}</span>
              <span v-if="i.justificativaDesvio">
                · {{ t('pep.planoCuidado.desvio', { texto: i.justificativaDesvio }) }}</span
              >
              <div v-if="podeGravar && p.situacao === 'ativo' && aberto(i)" class="plano__linha">
                <SanteBotao
                  v-if="i.situacao === 'pendente'"
                  variante="secundario"
                  :rotulo="t('pep.planoCuidado.iniciar')"
                  :data-testid="`plano-item-iniciar-${i.id}`"
                  @acionar="passoItem(i, 'iniciar')"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('pep.planoCuidado.concluir')"
                  :data-testid="`plano-item-concluir-${i.id}`"
                  @acionar="passoItem(i, 'concluir')"
                />
                <label>
                  {{ t('pep.planoCuidado.justificativaDesvio') }}
                  <input
                    v-model="campoItem[i.id]"
                    maxlength="500"
                    :data-testid="`plano-item-desvio-${i.id}`"
                  />
                </label>
                <SanteBotao
                  variante="secundario"
                  :desabilitado="!desvioOk(i)"
                  :rotulo="t('pep.planoCuidado.naoRealizar')"
                  @acionar="passoItem(i, 'nao_realizar')"
                />
                <SanteBotao
                  variante="secundario"
                  :desabilitado="!desvioOk(i)"
                  :rotulo="t('pep.planoCuidado.cancelarItem')"
                  @acionar="passoItem(i, 'cancelar')"
                />
              </div>
            </li>
          </ul>

          <template v-if="podeGravar && vigente(p)">
            <form class="plano__linha" :data-testid="`plano-incluir-${p.id}`" @submit.prevent="incluir(p)">
              <SanteSelecao v-model="cp(p).tipo" :rotulo="t('pep.planoCuidado.tipo')" :opcoes="opcoesTipo" />
              <SanteSelecao
                v-if="cp(p).tipo !== 'problema'"
                v-model="cp(p).superior"
                :rotulo="t('pep.planoCuidado.superior')"
                :opcoes="opcoesSuperior(p)"
              />
              <label class="plano__largo">
                {{ t('pep.planoCuidado.descricao') }}
                <input
                  v-model="cp(p).descricao"
                  maxlength="500"
                  :data-testid="`plano-item-descricao-${p.id}`"
                />
              </label>
              <label>
                {{ t('pep.planoCuidado.prazo') }}
                <input v-model="cp(p).prazo" type="date" :min="p.inicio ?? undefined" />
              </label>
              <SanteBotao
                tipo="submit"
                :desabilitado="!itemPronto(p)"
                :rotulo="t('pep.planoCuidado.incluir')"
              />
            </form>
            <div class="plano__linha">
              <SanteSelecao
                v-model="cp(p).risco"
                :rotulo="t('pep.planoCuidado.risco')"
                :opcoes="opcoesRisco.filter((o) => o.valor !== SEM)"
              />
              <SanteBotao
                variante="secundario"
                :desabilitado="cp(p).risco === SEM || cp(p).risco === p.risco"
                :rotulo="t('pep.planoCuidado.reestratificar')"
                :data-testid="`plano-reestratificar-${p.id}`"
                @acionar="passoPlano(p, 'estratificar', { risco: cp(p).risco })"
              />
              <SanteBotao
                v-if="p.situacao === 'rascunho'"
                :desabilitado="!podeAtivar(p)"
                :rotulo="t('pep.planoCuidado.ativar')"
                :data-testid="`plano-ativar-${p.id}`"
                @acionar="passoPlano(p, 'ativar')"
              />
              <SanteBotao
                v-if="p.situacao === 'ativo'"
                :desabilitado="!podeFechar(p)"
                :rotulo="t('pep.planoCuidado.fechar')"
                :data-testid="`plano-fechar-${p.id}`"
                @acionar="passoPlano(p, 'fechar')"
              />
              <small v-if="p.situacao === 'rascunho' && !podeAtivar(p)">{{
                t('pep.planoCuidado.ativarFalta')
              }}</small>
              <small v-if="p.situacao === 'ativo' && !podeFechar(p)">{{
                t('pep.planoCuidado.fecharFalta')
              }}</small>
            </div>
            <div class="plano__linha">
              <label class="plano__largo">
                {{ t('pep.planoCuidado.motivo') }}
                <input v-model="cp(p).motivo" maxlength="500" :data-testid="`plano-motivo-${p.id}`" />
              </label>
              <SanteBotao
                variante="secundario"
                :desabilitado="cp(p).motivo.trim().length < 5"
                :rotulo="t('pep.planoCuidado.cancelar')"
                @acionar="passoPlano(p, 'cancelar', { motivo: cp(p).motivo.trim() })"
              />
            </div>
          </template>
        </template>
      </article>
    </template>
  </section>
</template>

<style scoped>
.plano__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
  margin-block: var(--sgh-espaco-2);
}
.plano__largo {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.plano__marca {
  flex: 1 1 100%;
  display: inline-flex;
  gap: var(--sgh-espaco-2);
}
.plano__item {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
.plano__meta {
  color: var(--sgh-texto-secundario);
}
.plano__corpo {
  white-space: pre-wrap;
}
.plano__itens {
  list-style: none;
  padding: 0;
}
</style>
