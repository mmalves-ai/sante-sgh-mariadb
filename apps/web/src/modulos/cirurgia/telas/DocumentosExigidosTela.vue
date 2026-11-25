<script setup lang="ts">
// Documentos exigidos antes da cirurgia (C1-128, 04-CC linha 104): os tipos de documento (termo de consentimento,
// avaliação pré-anestésica, risco cirúrgico, exames, autorização) e as regras do estabelecimento por procedimento,
// fonte pagadora e faixa etária, com o que cada uma faz (bloqueia o início, gera pendência na confirmação, validade
// em dias). O consentimento e a avaliação pré-anestésica sempre bloqueiam o início (OMS/PNSP): a tela já marca e a
// regra do domínio valida na hora. Regra desativada fica na lista; nada é apagado.
import {
  CATEGORIAS_DOCUMENTO_PRE_OPERATORIO,
  CATEGORIAS_QUE_SEMPRE_BLOQUEIAM,
  conferirRegraDocumento,
  conferirTipoDocumento,
} from '@sgh/dominio-cirurgia';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  ativarRegraDocumento,
  ativarTipoDocumento,
  incluirRegraDocumento,
  incluirTipoDocumento,
  lerConfiguracaoDocumentos,
} from '../api-documentos-cirurgia.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Documentos exigidos antes da cirurgia',
      tipos: 'Tipos de documento',
      regras: 'Regras do estabelecimento',
      nenhumTipo: 'Nenhum tipo cadastrado.',
      nenhumaRegra: 'Nenhuma regra: só os tipos obrigatórios para toda cirurgia valem.',
      categorias: {
        consentimento: 'Termo de consentimento',
        risco_cirurgico: 'Risco cirúrgico',
        exame: 'Exame',
        autorizacao: 'Autorização',
        avaliacao: 'Avaliação pré-anestésica',
        outro: 'Outro',
      },
      codigo: 'Código',
      descricao: 'Descrição',
      categoria: 'Categoria',
      validade: 'Validade (dias)',
      obrigatorioTodas: 'Exigido em toda cirurgia (cadastro da plataforma)',
      dicaGeral:
        'Para exigir o documento em toda cirurgia deste estabelecimento, inclua a regra sem procedimento, fonte pagadora nem faixa etária.',
      incluirTipo: 'Incluir tipo',
      tipo: 'Documento',
      procedimento: 'Procedimento (vazio: todos)',
      fonte: 'Fonte pagadora (vazio: todas)',
      faixa: 'Faixa etária (vazio: todas)',
      todos: 'Todos',
      bloqueia: 'Bloqueia o início da cirurgia',
      pendencia: 'Pendência impede confirmar',
      incluirRegra: 'Incluir regra',
      desativar: 'Desativar',
      reativar: 'Reativar',
      inativa: 'inativa',
      gravado: 'Gravado.',
      resumoRegra: '{tipo} · {proc} · {fonte} · {faixa}',
      efeitos: '{bloqueia}{pendencia}{validade}',
      efeitoBloqueia: 'bloqueia o início',
      efeitoPendencia: ' · pendência na confirmação',
      efeitoValidade: ' · validade {n} dia(s)',
      escolha: 'Escolha',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('cirurgia.sala.editar'));
const consulta = useQuery({
  queryKey: ['cirurgia', 'documentos-exigidos'],
  queryFn: lerConfiguracaoDocumentos,
});
const d = computed(() => consulta.data.value);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const nTipo = ref({
  codigo: '',
  descricao: '',
  categoria: 'consentimento',
  validade: '',
});
const validadeNum = (v: string) => (v.trim() === '' ? null : Number(v));
const problemasTipo = computed(() =>
  nTipo.value.codigo || nTipo.value.descricao
    ? conferirTipoDocumento({
        codigo: nTipo.value.codigo,
        descricao: nTipo.value.descricao,
        categoria: nTipo.value.categoria,
        validadeDias: validadeNum(nTipo.value.validade),
      })
    : [],
);

const nRegra = ref({
  tipo: '',
  procedimento: '',
  fonte: '',
  faixa: '',
  validade: '',
  bloqueia: false,
  pendencia: true,
});
const tipoEscolhido = computed(() => d.value?.tipos.find((x) => String(x.id) === nRegra.value.tipo) ?? null);
const sempreBloqueia = computed(
  () => !!tipoEscolhido.value && CATEGORIAS_QUE_SEMPRE_BLOQUEIAM.includes(tipoEscolhido.value.categoria),
);
// Consentimento e avaliação pré-anestésica: o bloqueio já vem marcado e não se desmarca.
watch(sempreBloqueia, (s) => {
  if (s) nRegra.value.bloqueia = true;
});
const problemasRegra = computed(() =>
  nRegra.value.tipo
    ? conferirRegraDocumento(
        {
          tipo: Number(nRegra.value.tipo),
          procedimento: null,
          fontePagadora: null,
          faixaEtaria: null,
          validadeDias: validadeNum(nRegra.value.validade),
          bloqueiaEntradaSala: nRegra.value.bloqueia,
          geraPendencia: nRegra.value.pendencia,
        },
        tipoEscolhido.value,
      )
    : [],
);

const opcoesCategoria = computed(() =>
  CATEGORIAS_DOCUMENTO_PRE_OPERATORIO.map((c) => ({ valor: c, rotulo: t(`categorias.${c}`) })),
);
const opcoesTipo = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(d.value?.tipos ?? []).filter((x) => x.ativo).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
]);
const opcoes = (l: { id: number; rotulo: string }[] | undefined) => [
  { valor: '', rotulo: t('todos') },
  ...(l ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
];
const opcoesProc = computed(() => opcoes(d.value?.opcoes.procedimentos));
const opcoesFonte = computed(() => opcoes(d.value?.opcoes.fontes));
const opcoesFaixa = computed(() => opcoes(d.value?.opcoes.faixas));
const idOuNull = (v: string) => (v ? Number(v) : null);

async function rodar(fn: () => Promise<unknown>, limpar: () => void): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    limpar();
    mensagem.value = t('gravado');
    await cliente.invalidateQueries({ queryKey: ['cirurgia', 'documentos-exigidos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const gravarTipo = () =>
  rodar(
    () =>
      incluirTipoDocumento({
        codigo: nTipo.value.codigo.trim(),
        descricao: nTipo.value.descricao.trim(),
        categoria: nTipo.value.categoria,
        validadeDias: validadeNum(nTipo.value.validade),
      }),
    () => {
      nTipo.value = {
        codigo: '',
        descricao: '',
        categoria: 'consentimento',
        validade: '',
      };
    },
  );

const gravarRegra = () =>
  rodar(
    () =>
      incluirRegraDocumento({
        tipo: Number(nRegra.value.tipo),
        procedimento: idOuNull(nRegra.value.procedimento),
        fontePagadora: idOuNull(nRegra.value.fonte),
        faixaEtaria: idOuNull(nRegra.value.faixa),
        validadeDias: validadeNum(nRegra.value.validade),
        bloqueiaEntradaSala: nRegra.value.bloqueia,
        geraPendencia: nRegra.value.pendencia,
      }),
    () => {
      nRegra.value = {
        tipo: '',
        procedimento: '',
        fonte: '',
        faixa: '',
        validade: '',
        bloqueia: false,
        pendencia: true,
      };
    },
  );

const alternar = (id: number, versao: number, ativo: boolean) =>
  rodar(
    () => ativarRegraDocumento(id, versao, ativo),
    () => undefined,
  );

const alternarTipo = (id: number, versao: number, ativo: boolean) =>
  rodar(
    () => ativarTipoDocumento(id, versao, ativo),
    () => undefined,
  );
</script>

<template>
  <main class="tela" data-testid="documentos-exigidos">
    <h1>{{ t('titulo') }}</h1>
    <ErroCirurgia v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-if="d">
      <section class="painel" aria-labelledby="tipos-titulo">
        <h2 id="tipos-titulo">{{ t('tipos') }}</h2>
        <p v-if="!d.tipos.length">{{ t('nenhumTipo') }}</p>
        <ul v-else data-testid="documentos-tipos">
          <li v-for="x in d.tipos" :key="x.id" :data-testid="`tipo-${x.codigo}`" :data-ativo="x.ativo">
            <strong>{{ x.descricao }}</strong> ({{ x.codigo }}) · {{ t(`categorias.${x.categoria}`) }}
            <span v-if="x.obrigatorio"> · {{ t('obrigatorioTodas') }}</span>
            <span v-if="x.validadeDias"> · {{ t('efeitoValidade', { n: x.validadeDias }) }}</span>
            <span v-if="!x.ativo"> · {{ t('inativa') }}</span>
            <SanteBotao
              v-if="podeEditar && !x.obrigatorio"
              variante="texto"
              :rotulo="x.ativo ? t('desativar') : t('reativar')"
              :data-testid="`tipo-alternar-${x.codigo}`"
              @acionar="alternarTipo(x.id, x.versao, !x.ativo)"
            />
          </li>
        </ul>
        <form v-if="podeEditar" class="formulario" data-testid="tipo-form" @submit.prevent="gravarTipo">
          <SanteCampoTexto
            v-model="nTipo.codigo"
            :rotulo="t('codigo')"
            :max-bytes="30"
            data-testid="tipo-codigo"
          />
          <SanteCampoTexto
            v-model="nTipo.descricao"
            :rotulo="t('descricao')"
            :max-bytes="150"
            data-testid="tipo-descricao"
          />
          <SanteSelecao
            v-model="nTipo.categoria"
            :rotulo="t('categoria')"
            :opcoes="opcoesCategoria"
            data-testid="tipo-categoria"
          />
          <SanteCampoTexto
            v-model="nTipo.validade"
            :rotulo="t('validade')"
            :max-bytes="4"
            data-testid="tipo-validade"
          />
          <small data-testid="tipo-dica-geral">{{ t('dicaGeral') }}</small>
          <small v-for="p in problemasTipo" :key="p.campo" class="erro-campo" data-testid="tipo-problema">{{
            p.mensagem
          }}</small>
          <SanteBotao
            :rotulo="t('incluirTipo')"
            :desabilitado="!nTipo.codigo || problemasTipo.length > 0 || ocupado"
            data-testid="tipo-gravar"
            @acionar="gravarTipo"
          />
        </form>
      </section>

      <section class="painel" aria-labelledby="regras-titulo">
        <h2 id="regras-titulo">{{ t('regras') }}</h2>
        <p v-if="!d.regras.length">{{ t('nenhumaRegra') }}</p>
        <ul v-else data-testid="documentos-regras">
          <li v-for="r in d.regras" :key="r.id" :data-testid="`regra-${r.id}`" :data-ativa="r.ativo">
            {{
              t('resumoRegra', {
                tipo: r.tipoDescricao,
                proc: r.procedimentoDescricao ?? t('todos'),
                fonte: r.fonteNome ?? t('todos'),
                faixa: r.faixaDescricao ?? t('todos'),
              })
            }}
            —
            {{
              t('efeitos', {
                bloqueia: r.bloqueiaEntradaSala ? t('efeitoBloqueia') : '',
                pendencia: r.geraPendencia ? t('efeitoPendencia') : '',
                validade: r.validadeDias ? t('efeitoValidade', { n: r.validadeDias }) : '',
              })
            }}
            <span v-if="!r.ativo"> · {{ t('inativa') }}</span>
            <SanteBotao
              v-if="podeEditar"
              variante="texto"
              :rotulo="r.ativo ? t('desativar') : t('reativar')"
              :data-testid="`regra-alternar-${r.id}`"
              @acionar="alternar(r.id, r.versao, !r.ativo)"
            />
          </li>
        </ul>
        <form v-if="podeEditar" class="formulario" data-testid="regra-form" @submit.prevent="gravarRegra">
          <SanteSelecao
            v-model="nRegra.tipo"
            :rotulo="t('tipo')"
            :opcoes="opcoesTipo"
            data-testid="regra-tipo"
          />
          <SanteSelecao
            v-model="nRegra.procedimento"
            :rotulo="t('procedimento')"
            :opcoes="opcoesProc"
            data-testid="regra-procedimento"
          />
          <SanteSelecao
            v-model="nRegra.fonte"
            :rotulo="t('fonte')"
            :opcoes="opcoesFonte"
            data-testid="regra-fonte"
          />
          <SanteSelecao
            v-model="nRegra.faixa"
            :rotulo="t('faixa')"
            :opcoes="opcoesFaixa"
            data-testid="regra-faixa"
          />
          <SanteCampoTexto
            v-model="nRegra.validade"
            :rotulo="t('validade')"
            :max-bytes="4"
            data-testid="regra-validade"
          />
          <label
            ><input
              v-model="nRegra.bloqueia"
              type="checkbox"
              :disabled="sempreBloqueia"
              data-testid="regra-bloqueia"
            />
            {{ t('bloqueia') }}</label
          >
          <label
            ><input v-model="nRegra.pendencia" type="checkbox" data-testid="regra-pendencia" />
            {{ t('pendencia') }}</label
          >
          <small v-for="p in problemasRegra" :key="p.campo" class="erro-campo" data-testid="regra-problema">{{
            p.mensagem
          }}</small>
          <SanteBotao
            :rotulo="t('incluirRegra')"
            :desabilitado="!nRegra.tipo || problemasRegra.length > 0 || ocupado"
            data-testid="regra-gravar"
            @acionar="gravarRegra"
          />
        </form>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="documentos-exigidos-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </main>
</template>

<style scoped>
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.erro-campo {
  color: var(--sgh-texto-secundario);
}
</style>
