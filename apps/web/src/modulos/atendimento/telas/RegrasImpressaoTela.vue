<script setup lang="ts">
// Regras de impressão da recepção (02-REC linha 35): `/recepcao/atendimento/regras-impressao`. Uma tela só para o
// que antes pedia um cadastro por dimensão: os modelos de ficha, as regras (cada dimensão em branco vale para todos)
// e a conferência na hora — monta-se um atendimento de exemplo e a tela mostra as fichas que sairiam, pela mesma
// regra do domínio que o servidor usa. A regra repetida e os números fora do limite travam o botão sem ir ao
// servidor. Nada é apagado: modelo e regra saem de uso pela inativação (um clique) e voltam pela mesma linha.
import {
  COPIAS_MAXIMAS_FICHA,
  fichasPelasRegras,
  validarModeloFicha,
  validarRegraImpressao,
} from '@sgh/dominio-atendimento';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../api-atendimento.js';
import {
  type AcaoRegraImpressao,
  lerConfiguracaoImpressao,
  manterRegraImpressao,
  type ModeloFichaTela,
  type RegraImpressaoTela,
} from '../api-regras-impressao.js';

const { t } = useI18n();
const qc = useQueryClient();
const CHAVE = ['atendimento', 'regras-impressao'];
const dados = useQuery({ queryKey: CHAVE, queryFn: lerConfiguracaoImpressao });
const erro = ref<unknown>(null);
const mensagem = ref('');
const ocupado = ref(false);

const TIPOS = [
  'ficha_ambulatorial',
  'ficha_pronto_atendimento',
  'guia_consulta',
  'guia_sadt',
  'comprovante',
  'etiqueta',
  'outro',
] as const;
const idOuNulo = (v: string): number | null => (v === '' ? null : Number(v));
/** Texto de número inteiro: '' vira nulo; texto que não é inteiro vira NaN (a tela avisa e trava o botão). */
const inteiroOuNulo = (v: string): number | null =>
  v.trim() === '' ? null : /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
const comTodos = (lista: readonly { id: number; nome: string }[] | undefined) => [
  { valor: '', rotulo: t('regrasImpressao.todos') },
  ...(lista ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
];
const opcoesCopias = Array.from({ length: COPIAS_MAXIMAS_FICHA }, (_, i) => ({
  valor: String(i + 1),
  rotulo: String(i + 1),
}));
const opcoes = computed(() => dados.data.value?.opcoes);
const nomeDe = (lista: readonly { id: number; nome: string }[] | undefined, id: number | null) =>
  id === null ? null : (lista?.find((o) => o.id === id)?.nome ?? `#${id}`);
const modeloPorId = (id: number) => dados.data.value?.modelos.find((m) => m.id === id);

async function gravar(a: AcaoRegraImpressao): Promise<boolean> {
  erro.value = null;
  mensagem.value = '';
  ocupado.value = true;
  try {
    const r = await manterRegraImpressao(a, novaChave('regra-impressao'));
    mensagem.value = r.mensagem ?? '';
    await qc.invalidateQueries({ queryKey: CHAVE });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    ocupado.value = false;
  }
}

// ── Modelo ──
const modeloVazio = () => ({
  id: 0,
  versao: 0,
  codigo: '',
  titulo: '',
  tipo: 'ficha_ambulatorial',
  conteudo: '',
  copias: '1',
  ordem: '',
  somenteRetorno: false,
  idadeMinima: '',
  idadeMaxima: '',
  ativo: true,
});
const fm = ref(modeloVazio());
const numerosDoModelo = computed(() => ({
  ordem: inteiroOuNulo(fm.value.ordem),
  idadeMinima: inteiroOuNulo(fm.value.idadeMinima),
  idadeMaxima: inteiroOuNulo(fm.value.idadeMaxima),
}));
const avisoModelo = computed((): string | null => {
  const n = numerosDoModelo.value;
  if ([n.ordem, n.idadeMinima, n.idadeMaxima].some((x) => Number.isNaN(x)))
    return t('regrasImpressao.modelos.numeroInvalido');
  if (!fm.value.codigo.trim() || !fm.value.conteudo.trim()) return t('regrasImpressao.modelos.faltaTexto');
  return (
    validarModeloFicha({
      titulo: fm.value.titulo,
      copias: Number(fm.value.copias),
      idadeMinima: n.idadeMinima,
      idadeMaxima: n.idadeMaxima,
    })?.mensagem ?? null
  );
});
/** O aviso só aparece depois que a pessoa começou a preencher (o formulário vazio não nasce reclamando). */
const modeloTocado = computed(
  () => fm.value.id > 0 || fm.value.codigo !== '' || fm.value.titulo !== '' || fm.value.conteudo !== '',
);
function editarModelo(m: ModeloFichaTela): void {
  fm.value = {
    id: m.id,
    versao: m.versao,
    codigo: m.codigo,
    titulo: m.titulo,
    tipo: m.tipoDocumento,
    conteudo: m.conteudo ?? '',
    copias: String(m.copias),
    ordem: m.ordem === null ? '' : String(m.ordem),
    somenteRetorno: m.somenteRetorno,
    idadeMinima: m.idadeMinima === null ? '' : String(m.idadeMinima),
    idadeMaxima: m.idadeMaxima === null ? '' : String(m.idadeMaxima),
    ativo: m.ativo,
  };
}
async function gravarModelo(): Promise<void> {
  if (avisoModelo.value) return;
  const f = fm.value;
  const n = numerosDoModelo.value;
  const ok = await gravar({
    acao: 'modelo',
    ...(f.id > 0 ? { id: f.id, versao: f.versao } : {}),
    codigo: f.codigo.trim(),
    titulo: f.titulo.trim(),
    tipoDocumento: f.tipo,
    conteudo: f.conteudo.trim(),
    copias: Number(f.copias),
    ordem: n.ordem,
    somenteRetorno: f.somenteRetorno,
    idadeMinima: n.idadeMinima,
    idadeMaxima: n.idadeMaxima,
    ativo: f.ativo,
  });
  if (ok) fm.value = modeloVazio();
}
const faixaDeIdade = (m: ModeloFichaTela): string =>
  m.idadeMinima !== null && m.idadeMaxima !== null
    ? t('regrasImpressao.modelos.faixa', { de: m.idadeMinima, ate: m.idadeMaxima })
    : m.idadeMinima !== null
      ? t('regrasImpressao.modelos.apartir', { de: m.idadeMinima })
      : m.idadeMaxima !== null
        ? t('regrasImpressao.modelos.ate', { ate: m.idadeMaxima })
        : t('regrasImpressao.modelos.semLimite');

// ── Regra ──
const regraVazia = () => ({
  id: 0,
  versao: 0,
  modelo: '',
  todasUnidades: false,
  categoria: '',
  fontePagadora: '',
  especialidade: '',
  grupo: '',
  unidade: '',
  copias: '',
  selecionada: true,
  ativo: true,
});
const fr = ref(regraVazia());
const opcoesModelo = computed(() => [
  { valor: '', rotulo: t('regrasImpressao.regras.escolhaModelo') },
  ...(dados.data.value?.modelos ?? [])
    .filter((m) => m.ativo || String(m.id) === fr.value.modelo)
    .map((m) => ({ valor: String(m.id), rotulo: m.titulo })),
]);
const opcoesCopiasRegra = computed(() => [
  { valor: '', rotulo: t('regrasImpressao.regras.copiasDoModelo') },
  ...opcoesCopias,
]);
const regraEmEdicao = computed(() => dados.data.value?.regras.find((r) => r.id === fr.value.id) ?? null);
const alcanceDoFormulario = computed(() => ({
  estabelecimento: fr.value.todasUnidades ? null : (dados.data.value?.estabelecimento ?? null),
  categoria: idOuNulo(fr.value.categoria),
  fontePagadora: idOuNulo(fr.value.fontePagadora),
  especialidade: idOuNulo(fr.value.especialidade),
  grupo: idOuNulo(fr.value.grupo),
  unidade: fr.value.todasUnidades ? null : idOuNulo(fr.value.unidade),
  clinica: regraEmEdicao.value?.clinica ?? null,
}));
const avisoRegra = computed((): string | null => {
  if (fr.value.modelo === '') return null;
  return (
    validarRegraImpressao(
      {
        ...alcanceDoFormulario.value,
        id: fr.value.id || null,
        modelo: Number(fr.value.modelo),
        copias: idOuNulo(fr.value.copias),
        ativo: fr.value.ativo,
      },
      dados.data.value?.regras ?? [],
    )?.mensagem ?? null
  );
});
function editarRegra(r: RegraImpressaoTela): void {
  fr.value = {
    id: r.id,
    versao: r.versao,
    modelo: String(r.modelo),
    todasUnidades: r.estabelecimento === null,
    categoria: r.categoria === null ? '' : String(r.categoria),
    fontePagadora: r.fontePagadora === null ? '' : String(r.fontePagadora),
    especialidade: r.especialidade === null ? '' : String(r.especialidade),
    grupo: r.grupo === null ? '' : String(r.grupo),
    unidade: r.unidade === null ? '' : String(r.unidade),
    copias: r.copias === null ? '' : String(r.copias),
    selecionada: r.selecionada,
    ativo: r.ativo,
  };
}
const acaoDaRegra = (
  r: {
    id: number;
    versao: number;
    modelo: number;
    copias: number | null;
    selecionada: boolean;
    ativo: boolean;
  },
  a: {
    estabelecimento: number | null;
    categoria: number | null;
    fontePagadora: number | null;
    especialidade: number | null;
    grupo: number | null;
    unidade: number | null;
  },
): AcaoRegraImpressao => ({
  acao: 'regra',
  ...(r.id > 0 ? { id: r.id, versao: r.versao } : {}),
  modelo: r.modelo,
  todasUnidades: a.estabelecimento === null,
  categoria: a.categoria,
  fontePagadora: a.fontePagadora,
  especialidade: a.especialidade,
  grupo: a.grupo,
  unidade: a.unidade,
  copias: r.copias,
  selecionada: r.selecionada,
  ativo: r.ativo,
});
async function gravarRegra(): Promise<void> {
  if (fr.value.modelo === '' || avisoRegra.value) return;
  const f = fr.value;
  const ok = await gravar(
    acaoDaRegra(
      {
        id: f.id,
        versao: f.versao,
        modelo: Number(f.modelo),
        copias: idOuNulo(f.copias),
        selecionada: f.selecionada,
        ativo: f.ativo,
      },
      alcanceDoFormulario.value,
    ),
  );
  if (ok) fr.value = regraVazia();
}
/** Inativar e reativar num clique, pela mesma linha. */
async function alternarRegra(r: RegraImpressaoTela): Promise<void> {
  await gravar(acaoDaRegra({ ...r, ativo: !r.ativo }, r));
}
const deOutraUnidade = (r: RegraImpressaoTela): boolean =>
  r.estabelecimento !== null && r.estabelecimento !== dados.data.value?.estabelecimento;
function alcanceEmTexto(r: RegraImpressaoTela): string {
  const o = opcoes.value;
  const partes = [
    nomeDe(o?.categorias, r.categoria),
    nomeDe(o?.fontes, r.fontePagadora),
    nomeDe(o?.especialidades, r.especialidade),
    nomeDe(o?.grupos, r.grupo),
    nomeDe(o?.unidades, r.unidade),
    r.estabelecimento === null ? t('regrasImpressao.regras.redeToda') : null,
  ].filter((x): x is string => x !== null);
  return partes.length ? partes.join(' · ') : t('regrasImpressao.regras.alcanceGeral');
}

// ── Conferir o que sai (na hora, sem servidor) ──
const fc = ref({
  categoria: '',
  fontePagadora: '',
  especialidade: '',
  grupo: '',
  unidade: '',
  retorno: false,
  idade: '',
});
const fichasDoExemplo = computed(() => {
  const c = dados.data.value;
  if (!c) return [];
  const idade = inteiroOuNulo(fc.value.idade);
  const grupo = idOuNulo(fc.value.grupo);
  return fichasPelasRegras(c.modelos, c.regras, {
    estabelecimento: c.estabelecimento,
    categoria: idOuNulo(fc.value.categoria),
    fontePagadora: idOuNulo(fc.value.fontePagadora),
    especialidade: idOuNulo(fc.value.especialidade),
    unidade: idOuNulo(fc.value.unidade),
    clinica: null,
    grupos: grupo === null ? [] : [grupo],
    retorno: fc.value.retorno,
    idade: idade === null || Number.isNaN(idade) ? null : idade,
  });
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="regras-impressao-titulo" data-testid="tela-regras-impressao">
    <h1 id="regras-impressao-titulo">{{ t('regrasImpressao.titulo') }}</h1>
    <p>{{ t('regrasImpressao.texto') }}</p>
    <MensagemErro v-if="erro || dados.error.value" :erro="erro ?? dados.error.value" />
    <p v-if="mensagem" role="status" data-testid="regras-impressao-mensagem">{{ mensagem }}</p>
    <p v-if="!dados.data.value && !dados.error.value" role="status">
      {{ t('regrasImpressao.carregando') }}
    </p>
    <template v-if="dados.data.value">
      <section class="painel" aria-labelledby="ri-modelos">
        <h2 id="ri-modelos">{{ t('regrasImpressao.modelos.titulo') }}</h2>
        <p v-if="!dados.data.value.modelos.length" data-testid="modelos-vazio">
          {{ t('regrasImpressao.modelos.vazio') }}
        </p>
        <table v-else class="tabela" data-testid="tabela-modelos">
          <caption>
            {{
              t('regrasImpressao.modelos.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('regrasImpressao.modelos.tituloCampo') }}</th>
              <th scope="col">{{ t('regrasImpressao.modelos.tipo') }}</th>
              <th scope="col">{{ t('regrasImpressao.modelos.copias') }}</th>
              <th scope="col">{{ t('regrasImpressao.modelos.somenteRetorno') }}</th>
              <th scope="col">{{ t('regrasImpressao.modelos.idade') }}</th>
              <th scope="col">{{ t('regrasImpressao.modelos.regrasAtivas') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.situacao') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in dados.data.value.modelos" :key="m.id" :data-testid="`modelo-${m.id}`">
              <td>{{ m.titulo }}</td>
              <td>{{ t(`regrasImpressao.modelos.tipos.${m.tipoDocumento}`) }}</td>
              <td>{{ m.copias }}</td>
              <td>{{ m.somenteRetorno ? t('regrasImpressao.sim') : t('regrasImpressao.nao') }}</td>
              <td>{{ faixaDeIdade(m) }}</td>
              <td>{{ m.regrasAtivas }}</td>
              <td>{{ m.ativo ? t('regrasImpressao.ativa') : t('regrasImpressao.inativa') }}</td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('regrasImpressao.editar')"
                  :data-testid="`editar-modelo-${m.id}`"
                  @acionar="editarModelo(m)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form class="painel" data-testid="form-modelo" @submit.prevent="gravarModelo">
          <h3>
            {{
              fm.id > 0
                ? t('regrasImpressao.modelos.editando', { titulo: modeloPorId(fm.id)?.titulo ?? '' })
                : t('regrasImpressao.modelos.novo')
            }}
          </h3>
          <SanteCampoTexto
            id="ri-modelo-codigo"
            v-model="fm.codigo"
            :rotulo="t('regrasImpressao.modelos.codigo')"
            :max-bytes="30"
          />
          <SanteCampoTexto
            id="ri-modelo-titulo"
            v-model="fm.titulo"
            :rotulo="t('regrasImpressao.modelos.tituloCampo')"
            :max-bytes="150"
          />
          <SanteSelecao
            v-model="fm.tipo"
            :rotulo="t('regrasImpressao.modelos.tipo')"
            :opcoes="TIPOS.map((x) => ({ valor: x, rotulo: t(`regrasImpressao.modelos.tipos.${x}`) }))"
          />
          <SanteCampoTexto
            id="ri-modelo-conteudo"
            v-model="fm.conteudo"
            :rotulo="t('regrasImpressao.modelos.conteudo')"
            :max-bytes="20000"
            multilinha
          />
          <SanteSelecao
            v-model="fm.copias"
            :rotulo="t('regrasImpressao.modelos.copias')"
            :opcoes="opcoesCopias"
          />
          <SanteCampoTexto
            id="ri-modelo-ordem"
            v-model="fm.ordem"
            :rotulo="t('regrasImpressao.modelos.ordem')"
            :max-bytes="4"
          />
          <SanteCampoTexto
            id="ri-modelo-idade-minima"
            v-model="fm.idadeMinima"
            :rotulo="t('regrasImpressao.modelos.idadeMinima')"
            :max-bytes="3"
          />
          <SanteCampoTexto
            id="ri-modelo-idade-maxima"
            v-model="fm.idadeMaxima"
            :rotulo="t('regrasImpressao.modelos.idadeMaxima')"
            :max-bytes="3"
          />
          <SanteChave
            :ligada="fm.somenteRetorno"
            :rotulo="t('regrasImpressao.modelos.somenteRetorno')"
            data-testid="modelo-somente-retorno"
            @alternar="(v: boolean) => (fm.somenteRetorno = v)"
          />
          <SanteChave
            :ligada="fm.ativo"
            :rotulo="t('regrasImpressao.modelos.ativo')"
            data-testid="modelo-ativo"
            @alternar="(v: boolean) => (fm.ativo = v)"
          />
          <SanteAlerta
            v-if="modeloTocado && avisoModelo"
            variante="aviso"
            :texto="avisoModelo"
            data-testid="aviso-modelo"
          />
          <p class="acoes">
            <SanteBotao
              :rotulo="t('regrasImpressao.gravar')"
              :desabilitado="ocupado || avisoModelo !== null"
              data-testid="gravar-modelo"
              @acionar="gravarModelo"
            />
            <SanteBotao
              v-if="fm.id > 0"
              variante="secundario"
              :rotulo="t('regrasImpressao.cancelarEdicao')"
              @acionar="fm = modeloVazio()"
            />
          </p>
        </form>
      </section>

      <section class="painel" aria-labelledby="ri-regras">
        <h2 id="ri-regras">{{ t('regrasImpressao.regras.titulo') }}</h2>
        <p v-if="!dados.data.value.regras.length" data-testid="regras-vazio">
          {{ t('regrasImpressao.regras.vazio') }}
        </p>
        <table v-else class="tabela" data-testid="tabela-regras">
          <caption>
            {{
              t('regrasImpressao.regras.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('regrasImpressao.regras.modelo') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.alcance') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.copias') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.selecionada') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.situacao') }}</th>
              <th scope="col">{{ t('regrasImpressao.regras.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in dados.data.value.regras" :key="r.id" :data-testid="`regra-${r.id}`">
              <td>{{ modeloPorId(r.modelo)?.titulo ?? `#${r.modelo}` }}</td>
              <td>{{ alcanceEmTexto(r) }}</td>
              <td>{{ r.copias ?? t('regrasImpressao.regras.copiasDoModelo') }}</td>
              <td>{{ r.selecionada ? t('regrasImpressao.sim') : t('regrasImpressao.nao') }}</td>
              <td>{{ r.ativo ? t('regrasImpressao.ativa') : t('regrasImpressao.inativa') }}</td>
              <td v-if="deOutraUnidade(r)" class="secundario">
                {{ t('regrasImpressao.regras.deOutraUnidade') }}
              </td>
              <td v-else class="acoes">
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('regrasImpressao.editar')"
                  :data-testid="`editar-regra-${r.id}`"
                  @acionar="editarRegra(r)"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="r.ativo ? t('regrasImpressao.inativar') : t('regrasImpressao.reativar')"
                  :desabilitado="ocupado"
                  :data-testid="`alternar-regra-${r.id}`"
                  @acionar="alternarRegra(r)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form class="painel" data-testid="form-regra" @submit.prevent="gravarRegra">
          <h3>
            {{
              fr.id > 0
                ? t('regrasImpressao.regras.editando', {
                    titulo: modeloPorId(Number(fr.modelo))?.titulo ?? '',
                  })
                : t('regrasImpressao.regras.nova')
            }}
          </h3>
          <SanteSelecao
            v-model="fr.modelo"
            :rotulo="t('regrasImpressao.regras.modelo')"
            :opcoes="opcoesModelo"
          />
          <SanteSelecao
            v-model="fr.categoria"
            :rotulo="t('regrasImpressao.regras.categoria')"
            :opcoes="comTodos(opcoes?.categorias)"
          />
          <SanteSelecao
            v-model="fr.fontePagadora"
            :rotulo="t('regrasImpressao.regras.fontePagadora')"
            :opcoes="comTodos(opcoes?.fontes)"
          />
          <SanteSelecao
            v-model="fr.especialidade"
            :rotulo="t('regrasImpressao.regras.especialidade')"
            :opcoes="comTodos(opcoes?.especialidades)"
          />
          <SanteSelecao
            v-model="fr.grupo"
            :rotulo="t('regrasImpressao.regras.grupo')"
            :opcoes="comTodos(opcoes?.grupos)"
          />
          <SanteSelecao
            v-if="!fr.todasUnidades"
            v-model="fr.unidade"
            :rotulo="t('regrasImpressao.regras.unidade')"
            :opcoes="comTodos(opcoes?.unidades)"
          />
          <SanteSelecao
            v-model="fr.copias"
            :rotulo="t('regrasImpressao.regras.copias')"
            :opcoes="opcoesCopiasRegra"
          />
          <SanteChave
            :ligada="fr.selecionada"
            :rotulo="t('regrasImpressao.regras.selecionada')"
            data-testid="regra-selecionada"
            @alternar="(v: boolean) => (fr.selecionada = v)"
          />
          <SanteChave
            :ligada="fr.todasUnidades"
            :rotulo="t('regrasImpressao.regras.todasUnidades')"
            data-testid="regra-todas-unidades"
            @alternar="(v: boolean) => (fr.todasUnidades = v)"
          />
          <SanteAlerta v-if="avisoRegra" variante="aviso" :texto="avisoRegra" data-testid="aviso-regra" />
          <p class="acoes">
            <SanteBotao
              :rotulo="t('regrasImpressao.gravar')"
              :desabilitado="ocupado || fr.modelo === '' || avisoRegra !== null"
              data-testid="gravar-regra"
              @acionar="gravarRegra"
            />
            <SanteBotao
              v-if="fr.id > 0"
              variante="secundario"
              :rotulo="t('regrasImpressao.cancelarEdicao')"
              @acionar="fr = regraVazia()"
            />
          </p>
        </form>
      </section>

      <section class="painel" aria-labelledby="ri-conferir" data-testid="conferir-impressao">
        <h2 id="ri-conferir">{{ t('regrasImpressao.conferir.titulo') }}</h2>
        <p>{{ t('regrasImpressao.conferir.texto') }}</p>
        <SanteSelecao
          v-model="fc.categoria"
          :rotulo="t('regrasImpressao.regras.categoria')"
          :opcoes="comTodos(opcoes?.categorias)"
        />
        <SanteSelecao
          v-model="fc.fontePagadora"
          :rotulo="t('regrasImpressao.regras.fontePagadora')"
          :opcoes="comTodos(opcoes?.fontes)"
        />
        <SanteSelecao
          v-model="fc.especialidade"
          :rotulo="t('regrasImpressao.regras.especialidade')"
          :opcoes="comTodos(opcoes?.especialidades)"
        />
        <SanteSelecao
          v-model="fc.grupo"
          :rotulo="t('regrasImpressao.regras.grupo')"
          :opcoes="comTodos(opcoes?.grupos)"
        />
        <SanteSelecao
          v-model="fc.unidade"
          :rotulo="t('regrasImpressao.regras.unidade')"
          :opcoes="comTodos(opcoes?.unidades)"
        />
        <SanteCampoTexto
          id="ri-conferir-idade"
          v-model="fc.idade"
          :rotulo="t('regrasImpressao.conferir.idade')"
          :max-bytes="3"
        />
        <SanteChave
          :ligada="fc.retorno"
          :rotulo="t('regrasImpressao.conferir.retorno')"
          data-testid="conferir-retorno"
          @alternar="(v: boolean) => (fc.retorno = v)"
        />
        <h3>{{ t('regrasImpressao.conferir.resultado') }}</h3>
        <p v-if="!fichasDoExemplo.length" data-testid="conferir-nada">
          {{ t('regrasImpressao.conferir.nada') }}
        </p>
        <ul v-else data-testid="conferir-fichas">
          <li v-for="f in fichasDoExemplo" :key="f.modelo">
            {{ t('regrasImpressao.conferir.linha', { nome: f.nome, n: f.copias }) }}
            <span v-if="!f.selecionada" class="secundario"
              >({{ t('regrasImpressao.conferir.desmarcada') }})</span
            >
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
