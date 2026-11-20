<script setup lang="ts">
// Editor estruturado da versão nova do protocolo de classificação (ficha do M44, seção 7; cap-11 §11.1): dados gerais
// e licença, a tabela das cinco cores (nome, tempo-alvo, prioridade no formulário do prontuário), os fluxogramas e, do
// fluxograma escolhido, os discriminadores com a cor e a regra montada por variável, operador e valor (o JSON Logic
// sai do motor puro: regraDasCondicoes). A regra que não cabe nessa forma fica como está e só muda na visão avançada.
// Toda mudança troca o valor inteiro (o modelo não é mutado por dentro).
import {
  CORES_RISCO,
  type ConteudoProtocolo,
  type CorRisco,
  type Discriminador,
  TIPOS_PROTOCOLO_CLASSIFICACAO,
  VARIAVEIS_CLASSIFICACAO,
  type VariavelClassificacao,
} from '@sgh/contratos';
import {
  codigoDoTitulo,
  condicoesDaRegra,
  type CondicaoRegra,
  OPERADORES_CONDICAO,
  type OperadorCondicao,
  type RegraMontada,
  regraDasCondicoes,
} from '@sgh/dominio-recepcao';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MarcaRisco from './MarcaRisco.vue';

const m = defineModel<ConteudoProtocolo>({ required: true });
const { t } = useI18n();

function alterar(fn: (c: ConteudoProtocolo) => void): void {
  const c = JSON.parse(JSON.stringify(m.value)) as ConteudoProtocolo;
  fn(c);
  m.value = c;
}
const numero = (v: string): number | null => {
  const s = v.trim().replace(',', '.');
  return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
};
const valorDe = (e: Event) => (e.target as HTMLInputElement).value;

// ── Geral e licença ───────────────────────────────────────────────────────────────────────────────
const opcoesTipo = TIPOS_PROTOCOLO_CLASSIFICACAO.map((x) => ({
  valor: x.codigo as string,
  rotulo: t(`classificacao.protocolo.tipos.${x.codigo}`),
}));
const exigeLicenca = computed(
  () => TIPOS_PROTOCOLO_CLASSIFICACAO.find((x) => x.codigo === m.value.tipo)?.exigeLicenca ?? false,
);
function mudarTipo(v: string): void {
  alterar((c) => {
    c.tipo = v as ConteudoProtocolo['tipo'];
    if (!exigeLicencaDe(v)) c.licenca = null;
    else c.licenca ??= { registro: '', titular: '', validaAte: '' };
  });
}
const exigeLicencaDe = (v: string) =>
  TIPOS_PROTOCOLO_CLASSIFICACAO.find((x) => x.codigo === v)?.exigeLicenca ?? false;
function mudarLicenca(campo: 'registro' | 'titular' | 'validaAte', v: string): void {
  alterar((c) => {
    c.licenca = { ...(c.licenca ?? { registro: '', titular: '', validaAte: '' }), [campo]: v.trim() };
  });
}

// ── Cores ─────────────────────────────────────────────────────────────────────────────────────────
const opcoesE08 = [
  { valor: '', rotulo: t('classificacao.protocolo.semOpcao') },
  ...Array.from({ length: 9 }, (_, i) => ({
    valor: String(i + 1),
    rotulo: t('classificacao.protocolo.editorOpcao', { n: i + 1 }),
  })),
];
function mudarCor(cor: CorRisco, campo: 'nome' | 'tempoAlvoMin' | 'opcaoE08', v: string): void {
  alterar((c) => {
    const x = c.cores.find((k) => k.cor === cor);
    if (!x) return;
    if (campo === 'nome') x.nome = v.trim();
    else if (campo === 'tempoAlvoMin') {
      const n = numero(v);
      if (n !== null) x.tempoAlvoMin = Math.round(n);
    } else x.opcaoE08 = v === '' ? null : Number(v);
  });
}

// ── Fluxogramas ───────────────────────────────────────────────────────────────────────────────────
const fluxoEmEdicao = ref<string>(m.value.fluxogramas[0]?.codigo ?? '');
watch(
  () => m.value.fluxogramas.map((f) => f.codigo).join(','),
  () => {
    if (!m.value.fluxogramas.some((f) => f.codigo === fluxoEmEdicao.value))
      fluxoEmEdicao.value = m.value.fluxogramas[0]?.codigo ?? '';
  },
);
const opcoesFluxo = computed(() =>
  m.value.fluxogramas.map((f) => ({ valor: f.codigo, rotulo: `${f.titulo} (${f.codigo})` })),
);
const novoFluxo = ref('');
function incluirFluxograma(): void {
  const titulo = novoFluxo.value.trim();
  if (titulo.length < 2) return;
  const codigo = codigoDoTitulo(titulo, new Set(m.value.fluxogramas.map((f) => f.codigo)));
  alterar((c) => {
    c.fluxogramas.push({ codigo, titulo });
  });
  novoFluxo.value = '';
  fluxoEmEdicao.value = codigo;
}
function mudarTituloFluxo(codigo: string, v: string): void {
  alterar((c) => {
    const f = c.fluxogramas.find((x) => x.codigo === codigo);
    if (f) f.titulo = v.trim();
  });
}
function removerFluxograma(codigo: string): void {
  alterar((c) => {
    c.fluxogramas = c.fluxogramas.filter((f) => f.codigo !== codigo);
    c.discriminadores = c.discriminadores.filter((d) => d.fluxograma !== codigo);
  });
}

// ── Discriminadores do fluxograma em edição ───────────────────────────────────────────────────────
const doFluxo = computed(() => m.value.discriminadores.filter((d) => d.fluxograma === fluxoEmEdicao.value));
const opcoesCor = CORES_RISCO.map((c) => ({
  valor: c.codigo as string,
  rotulo: t(`classificacao.cores.${c.codigo}`),
}));
const opcoesVariavel = VARIAVEIS_CLASSIFICACAO.map((v) => ({
  valor: v.codigo as string,
  rotulo: v.unidade ? `${v.rotulo} (${v.unidade})` : v.rotulo,
}));
const opcoesOperador = OPERADORES_CONDICAO.map((o) => ({
  valor: o.codigo as string,
  rotulo: t(`classificacao.protocolo.operadores.${operadorChave(o.codigo)}`),
}));
function operadorChave(o: OperadorCondicao): string {
  return {
    '<': 'menor',
    '<=': 'menorIgual',
    '>': 'maior',
    '>=': 'maiorIgual',
    '==': 'igual',
    '!=': 'diferente',
  }[o];
}
const opcoesJuncao = [
  { valor: 'and', rotulo: t('classificacao.protocolo.juncaoTodas') },
  { valor: 'or', rotulo: t('classificacao.protocolo.juncaoQualquer') },
];
const montada = (d: Discriminador) => condicoesDaRegra(d.regra);

function alterarDisc(codigo: string, fn: (d: Discriminador) => void): void {
  alterar((c) => {
    const d = c.discriminadores.find((x) => x.fluxograma === fluxoEmEdicao.value && x.codigo === codigo);
    if (d) fn(d);
  });
}
function alterarRegra(
  codigo: string,
  fn: (r: { juncao: 'and' | 'or'; condicoes: CondicaoRegra[] }) => void,
): void {
  alterarDisc(codigo, (d) => {
    const atual = condicoesDaRegra(d.regra);
    if (atual === 'avancada') return;
    const r = { juncao: atual.juncao, condicoes: [...atual.condicoes] };
    fn(r);
    d.regra = regraDasCondicoes(r as RegraMontada);
  });
}
function mudarCondicao(codigo: string, i: number, campo: 'variavel' | 'operador' | 'valor', v: string): void {
  alterarRegra(codigo, (r) => {
    const c = r.condicoes[i];
    if (!c) return;
    if (campo === 'variavel') r.condicoes[i] = { ...c, variavel: v as VariavelClassificacao };
    else if (campo === 'operador') r.condicoes[i] = { ...c, operador: v as OperadorCondicao };
    else {
      const n = numero(v);
      if (n !== null) r.condicoes[i] = { ...c, valor: n };
    }
  });
}
const novoDisc = ref('');
function incluirDiscriminador(): void {
  const titulo = novoDisc.value.trim();
  if (titulo.length < 2 || !fluxoEmEdicao.value) return;
  const codigo = codigoDoTitulo(titulo, new Set(doFluxo.value.map((d) => d.codigo)));
  alterar((c) => {
    c.discriminadores.push({
      codigo,
      fluxograma: fluxoEmEdicao.value,
      titulo,
      cor: 'verde',
      regra: null,
      sugereProtocolo: null,
    });
  });
  novoDisc.value = '';
}
</script>

<template>
  <div class="editor-protocolo" data-testid="editor-estruturado">
    <fieldset class="painel">
      <legend>{{ t('classificacao.protocolo.editorGeral') }}</legend>
      <div class="campo">
        <label for="ed-nome">{{ t('classificacao.protocolo.editorNome') }}</label>
        <input
          id="ed-nome"
          :value="m.nome"
          maxlength="80"
          data-testid="ed-nome"
          @change="alterar((c) => (c.nome = valorDe($event).trim()))"
        />
      </div>
      <SanteSelecao
        :model-value="m.tipo"
        :rotulo="t('classificacao.protocolo.tipo')"
        :opcoes="opcoesTipo"
        data-testid="ed-tipo"
        @update:model-value="mudarTipo(String($event))"
      />
      <template v-if="exigeLicenca">
        <div class="campo">
          <label for="ed-lic-registro">{{ t('classificacao.protocolo.licencaRegistro') }}</label>
          <input
            id="ed-lic-registro"
            :value="m.licenca?.registro ?? ''"
            maxlength="60"
            data-testid="ed-lic-registro"
            @change="mudarLicenca('registro', valorDe($event))"
          />
        </div>
        <div class="campo">
          <label for="ed-lic-titular">{{ t('classificacao.protocolo.licencaTitular') }}</label>
          <input
            id="ed-lic-titular"
            :value="m.licenca?.titular ?? ''"
            maxlength="120"
            data-testid="ed-lic-titular"
            @change="mudarLicenca('titular', valorDe($event))"
          />
        </div>
        <div class="campo">
          <label for="ed-lic-validade">{{ t('classificacao.protocolo.licencaValidade') }}</label>
          <input
            id="ed-lic-validade"
            type="date"
            :value="m.licenca?.validaAte ?? ''"
            data-testid="ed-lic-validade"
            @change="mudarLicenca('validaAte', valorDe($event))"
          />
        </div>
      </template>
    </fieldset>

    <fieldset class="painel">
      <legend>{{ t('classificacao.protocolo.cores') }}</legend>
      <table class="tabela-simples" data-testid="ed-cores">
        <thead>
          <tr>
            <th scope="col">{{ t('classificacao.protocolo.editorCor') }}</th>
            <th scope="col">{{ t('classificacao.protocolo.editorNome') }}</th>
            <th scope="col">{{ t('classificacao.protocolo.tempoAlvo') }}</th>
            <th scope="col">{{ t('classificacao.protocolo.opcaoProntuario') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in m.cores" :key="c.cor" :data-testid="`ed-cor-${c.cor}`">
            <td><MarcaRisco :cor="c.cor" /></td>
            <td>
              <input
                :value="c.nome"
                maxlength="40"
                :aria-label="
                  t('classificacao.protocolo.editorNomeDaCor', { cor: t(`classificacao.cores.${c.cor}`) })
                "
                :data-testid="`ed-cor-${c.cor}-nome`"
                @change="mudarCor(c.cor, 'nome', valorDe($event))"
              />
            </td>
            <td>
              <input
                :value="c.tempoAlvoMin"
                inputmode="numeric"
                :aria-label="
                  t('classificacao.protocolo.editorTempoDaCor', { cor: t(`classificacao.cores.${c.cor}`) })
                "
                :data-testid="`ed-cor-${c.cor}-tempo`"
                @change="mudarCor(c.cor, 'tempoAlvoMin', valorDe($event))"
              />
            </td>
            <td>
              <SanteSelecao
                :model-value="c.opcaoE08 === null ? '' : String(c.opcaoE08)"
                :rotulo="
                  t('classificacao.protocolo.editorOpcaoDaCor', { cor: t(`classificacao.cores.${c.cor}`) })
                "
                ocultar-rotulo
                :opcoes="opcoesE08"
                :data-testid="`ed-cor-${c.cor}-opcao`"
                @update:model-value="mudarCor(c.cor, 'opcaoE08', String($event ?? ''))"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </fieldset>

    <fieldset class="painel">
      <legend>{{ t('classificacao.protocolo.fluxogramas') }}</legend>
      <ul class="lista-simples" data-testid="ed-fluxogramas">
        <li v-for="f in m.fluxogramas" :key="f.codigo" :data-testid="`ed-fluxo-${f.codigo}`">
          <input
            :value="f.titulo"
            maxlength="80"
            :aria-label="t('classificacao.protocolo.editorTituloFluxo', { codigo: f.codigo })"
            @change="mudarTituloFluxo(f.codigo, valorDe($event))"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('classificacao.protocolo.editorRemover')"
            :data-testid="`ed-fluxo-${f.codigo}-remover`"
            @acionar="removerFluxograma(f.codigo)"
          />
        </li>
      </ul>
      <div class="campo">
        <label for="ed-novo-fluxo">{{ t('classificacao.protocolo.editorNovoFluxo') }}</label>
        <input id="ed-novo-fluxo" v-model="novoFluxo" maxlength="80" data-testid="ed-novo-fluxo" />
        <SanteBotao
          variante="secundario"
          :rotulo="t('classificacao.protocolo.editorIncluir')"
          :desabilitado="novoFluxo.trim().length < 2"
          data-testid="ed-incluir-fluxo"
          @acionar="incluirFluxograma()"
        />
      </div>
    </fieldset>

    <fieldset v-if="m.fluxogramas.length" class="painel">
      <legend>{{ t('classificacao.protocolo.editorDiscriminadores') }}</legend>
      <SanteSelecao
        v-model="fluxoEmEdicao"
        :rotulo="t('classificacao.protocolo.editorFluxoEmEdicao')"
        :opcoes="opcoesFluxo"
        :busca="true"
        data-testid="ed-fluxo-em-edicao"
      />
      <div
        v-for="d in doFluxo"
        :key="`${d.fluxograma}/${d.codigo}`"
        class="painel"
        :data-testid="`ed-disc-${d.codigo}`"
      >
        <div class="campo">
          <label :for="`ed-disc-${d.codigo}-titulo`">{{
            t('classificacao.protocolo.editorDiscriminador')
          }}</label>
          <input
            :id="`ed-disc-${d.codigo}-titulo`"
            :value="d.titulo"
            maxlength="120"
            @change="alterarDisc(d.codigo, (x) => (x.titulo = valorDe($event).trim()))"
          />
        </div>
        <SanteSelecao
          :model-value="d.cor"
          :rotulo="t('classificacao.protocolo.editorCorProposta')"
          :opcoes="opcoesCor"
          :data-testid="`ed-disc-${d.codigo}-cor`"
          @update:model-value="alterarDisc(d.codigo, (x) => (x.cor = String($event) as CorRisco))"
        />
        <template v-if="montada(d) === 'avancada'">
          <p class="secundario" :data-testid="`ed-disc-${d.codigo}-avancada`">
            {{ t('classificacao.protocolo.editorRegraAvancada', { regra: JSON.stringify(d.regra) }) }}
          </p>
        </template>
        <template v-else>
          <p class="secundario">
            {{
              (montada(d) as RegraMontada).condicoes.length === 0
                ? t('classificacao.protocolo.regraManual')
                : t('classificacao.protocolo.editorRegraAutomatica')
            }}
          </p>
          <SanteSelecao
            v-if="(montada(d) as RegraMontada).condicoes.length > 1"
            :model-value="(montada(d) as RegraMontada).juncao"
            :rotulo="t('classificacao.protocolo.editorJuncao')"
            :opcoes="opcoesJuncao"
            :data-testid="`ed-disc-${d.codigo}-juncao`"
            @update:model-value="alterarRegra(d.codigo, (r) => (r.juncao = String($event) as 'and' | 'or'))"
          />
          <div
            v-for="(c, i) in (montada(d) as RegraMontada).condicoes"
            :key="i"
            class="linha-condicao"
            :data-testid="`ed-disc-${d.codigo}-cond-${i}`"
          >
            <SanteSelecao
              :model-value="c.variavel"
              :rotulo="t('classificacao.protocolo.editorVariavel')"
              :opcoes="opcoesVariavel"
              :data-testid="`ed-disc-${d.codigo}-cond-${i}-variavel`"
              @update:model-value="mudarCondicao(d.codigo, i, 'variavel', String($event))"
            />
            <SanteSelecao
              :model-value="c.operador"
              :rotulo="t('classificacao.protocolo.editorOperador')"
              :opcoes="opcoesOperador"
              :data-testid="`ed-disc-${d.codigo}-cond-${i}-operador`"
              @update:model-value="mudarCondicao(d.codigo, i, 'operador', String($event))"
            />
            <div class="campo">
              <label :for="`ed-disc-${d.codigo}-cond-${i}-valor`">{{
                t('classificacao.protocolo.editorValor')
              }}</label>
              <input
                :id="`ed-disc-${d.codigo}-cond-${i}-valor`"
                :value="c.valor"
                inputmode="decimal"
                :data-testid="`ed-disc-${d.codigo}-cond-${i}-valor`"
                @change="mudarCondicao(d.codigo, i, 'valor', valorDe($event))"
              />
            </div>
            <SanteBotao
              variante="texto"
              :rotulo="t('classificacao.protocolo.editorRemoverCondicao')"
              :data-testid="`ed-disc-${d.codigo}-cond-${i}-remover`"
              @acionar="alterarRegra(d.codigo, (r) => r.condicoes.splice(i, 1))"
            />
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="t('classificacao.protocolo.editorIncluirCondicao')"
            :data-testid="`ed-disc-${d.codigo}-incluir-cond`"
            @acionar="
              alterarRegra(d.codigo, (r) => r.condicoes.push({ variavel: 'dor', operador: '>=', valor: 8 }))
            "
          />
        </template>
        <SanteBotao
          variante="texto"
          :rotulo="t('classificacao.protocolo.editorRemover')"
          :data-testid="`ed-disc-${d.codigo}-remover`"
          @acionar="
            alterar((x) => {
              x.discriminadores = x.discriminadores.filter(
                (k) => !(k.fluxograma === d.fluxograma && k.codigo === d.codigo),
              );
            })
          "
        />
      </div>
      <div class="campo">
        <label for="ed-novo-disc">{{ t('classificacao.protocolo.editorNovoDiscriminador') }}</label>
        <input id="ed-novo-disc" v-model="novoDisc" maxlength="120" data-testid="ed-novo-disc" />
        <SanteBotao
          variante="secundario"
          :rotulo="t('classificacao.protocolo.editorIncluir')"
          :desabilitado="novoDisc.trim().length < 2"
          data-testid="ed-incluir-disc"
          @acionar="incluirDiscriminador()"
        />
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.linha-condicao {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
</style>
