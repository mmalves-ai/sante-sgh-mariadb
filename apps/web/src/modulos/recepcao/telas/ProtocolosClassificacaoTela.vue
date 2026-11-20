<script setup lang="ts">
// Protocolos de classificação (ficha do M44, seção 7; regra 2; DP-18): `/administracao/pa/protocolos`. As versões
// publicadas (a primeira é a vigente; as outras, substituídas e legíveis), cada uma com as cores, os tempos-alvo, a
// prioridade equivalente no formulário de classificação do prontuário, os fluxogramas e os discriminadores com a
// regra, a licença e a impressão digital. O editor da versão nova parte da vigente (ou do protocolo de teste) e é
// estruturado (cores, fluxogramas, discriminadores e a regra por variável, operador e valor; o JSON fica só na visão
// avançada), mostra a diferença em relação à vigente, roda o simulador (a mesma proposta do motor) e publica com a
// reautenticação; quem escreveu (outro usuário ativo, conferido no servidor) e quem aprova não podem ser a mesma
// pessoa. Nada é gravado antes de publicar; a publicada não muda.
import '../componentes/estilo-classificacao.css';
import { type ConteudoProtocolo, esquemaConteudoProtocolo } from '@sgh/contratos';
import { diferencaDoProtocolo, PROTOCOLO_SINTETICO } from '@sgh/dominio-recepcao';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  lerVersaoProtocolo,
  lerVersoesProtocolo,
  novaChaveClassificacao,
  publicarProtocolo,
  simularProtocolo,
} from '../api-classificacao.js';
import EditorProtocolo from '../componentes/EditorProtocolo.vue';
import ErroClassificacao from '../componentes/ErroClassificacao.vue';
import MarcaRisco from '../componentes/MarcaRisco.vue';
import DefinicoesGerenciadas from '../componentes/DefinicoesGerenciadas.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const versoes = useQuery({ queryKey: ['classificacao', 'versoes'], queryFn: () => lerVersoesProtocolo() });
const escolhida = ref<number | null>(null);
watch(
  () => versoes.data.value,
  (v) => {
    if (v?.length && escolhida.value === null) escolhida.value = v[0]!.id;
  },
  { immediate: true },
);
const versao = useQuery({
  queryKey: computed(() => ['classificacao', 'versao', escolhida.value]),
  queryFn: () => lerVersaoProtocolo(escolhida.value!),
  enabled: computed(() => escolhida.value !== null),
});
const podePublicar = computed(() => pode('recepcao.protocolo.publicar'));

// ── Editor e simulador ───────────────────────────────────────────────────────────────────────────
const rascunho = ref<ConteudoProtocolo | null>(null);
/** Visão avançada: o JSON do rascunho, aplicado só pelo botão (o editor estruturado é o caminho comum). */
const texto = ref('');
const textoInvalido = ref(false);
const autor = ref('');
const notas = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const simulacao = ref<Awaited<ReturnType<typeof simularProtocolo>> | null>(null);
const fluxoSimulado = ref('');
const sinaisSimulados = ref<Record<string, string>>({
  pas: '',
  fc: '',
  fr: '',
  saturacao: '',
  temperatura: '',
  dor: '',
});

function partirDe(c: unknown): void {
  rascunho.value = JSON.parse(JSON.stringify(c)) as ConteudoProtocolo;
  simulacao.value = null;
}
watch(
  rascunho,
  (r) => {
    texto.value = r ? JSON.stringify(r, null, 2) : '';
    textoInvalido.value = false;
    simulacao.value = null;
  },
  { deep: true },
);
function aplicarAvancado(): void {
  try {
    const r = esquemaConteudoProtocolo.safeParse(JSON.parse(texto.value));
    if (!r.success) {
      textoInvalido.value = true;
      return;
    }
    rascunho.value = r.data;
  } catch {
    textoInvalido.value = true;
  }
}
const validacao = computed(() =>
  rascunho.value ? esquemaConteudoProtocolo.safeParse(rascunho.value) : null,
);
const conteudo = computed(() => (validacao.value?.success ? validacao.value.data : null));
const problemaDoRascunho = computed(() => {
  const v = validacao.value;
  if (!v || v.success) return null;
  const i = v.error.issues[0];
  return i ? `${i.path.join(' › ')}: ${i.message}` : null;
});
/** A diferença em relação à vigente (a primeira da lista), antes de publicar. */
const vigenteConteudo = computed(() =>
  versao.data.value && versoes.data.value?.[0]?.id === versao.data.value.versao.id
    ? versao.data.value.conteudo
    : null,
);
const diferenca = computed(() =>
  conteudo.value ? diferencaDoProtocolo(vigenteConteudo.value, conteudo.value) : [],
);
const opcoesFluxo = computed(() => [
  { valor: '', rotulo: t('classificacao.tela.escolhaFluxograma') },
  ...(conteudo.value?.fluxogramas ?? []).map((f) => ({ valor: f.codigo, rotulo: f.titulo })),
]);
const num = (v: string | undefined) => {
  const s = (v ?? '').trim().replace(',', '.');
  return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
};
async function simular(): Promise<void> {
  if (!conteudo.value || !fluxoSimulado.value) return;
  erro.value = null;
  try {
    simulacao.value = await simularProtocolo({
      conteudo: conteudo.value,
      fluxograma: fluxoSimulado.value,
      sinais: {
        pas: num(sinaisSimulados.value['pas']),
        pad: null,
        fc: num(sinaisSimulados.value['fc']),
        fr: num(sinaisSimulados.value['fr']),
        temperatura: num(sinaisSimulados.value['temperatura']),
        saturacao: num(sinaisSimulados.value['saturacao']),
        glicemia: null,
        dor: num(sinaisSimulados.value['dor']),
        glasgow: null,
      },
    });
  } catch (x) {
    erro.value = x;
  }
}
const prontoPublicar = computed(
  () =>
    !!conteudo.value &&
    autor.value.trim().length >= 2 &&
    notas.value.trim().length >= 3 &&
    senha.value !== '',
);
async function publicar(): Promise<void> {
  if (!conteudo.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const vigente = versoes.data.value?.[0];
    const r = await publicarProtocolo(
      {
        ...(vigente && vigente.tipo === conteudo.value.tipo ? { protocolo: vigente.protocolo } : {}),
        autor: autor.value.trim().toUpperCase(),
        conteudo: conteudo.value,
        notas: notas.value.trim(),
        senha: senha.value,
      },
      novaChaveClassificacao('publicar'),
    );
    mensagem.value = r.mensagem;
    senha.value = '';
    escolhida.value = r.id;
    await cliente.invalidateQueries({ queryKey: ['classificacao'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const regraTexto = (r: unknown) => (r === null || r === undefined ? null : JSON.stringify(r));
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="protocolos-titulo"
    data-testid="tela-protocolos-classificacao"
  >
    <h1 id="protocolos-titulo">{{ t('classificacao.protocolo.titulo') }}</h1>
    <p>{{ t('classificacao.protocolo.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/pa/classificacao">{{ t('classificacao.fila.titulo') }}</RouterLink>
      <RouterLink to="/administracao/pa/cores-legado">{{
        t('classificacao.fila.coresAnteriores')
      }}</RouterLink>
    </p>
    <section class="painel" aria-labelledby="protocolos-versoes">
      <h2 id="protocolos-versoes">{{ t('classificacao.protocolo.versoes') }}</h2>
      <ErroClassificacao v-if="versoes.isError.value" :erro="versoes.error.value" />
      <p v-else-if="!versoes.data.value" role="status">{{ t('classificacao.carregando') }}</p>
      <p v-else-if="versoes.data.value.length === 0" data-testid="protocolos-nenhum">
        {{ t('classificacao.protocolo.nenhuma') }}
      </p>
      <ul v-else class="lista-simples">
        <li v-for="v in versoes.data.value" :key="v.id" :data-testid="`versao-${v.id}`">
          <strong>{{ v.nome }}</strong> · {{ t('classificacao.protocolo.versao', { n: v.versao }) }} ·
          {{ t(`classificacao.protocolo.situacoes.${v.situacao}`) }} ·
          {{ t(`classificacao.protocolo.tipos.${v.tipo}`) }} · {{ t('classificacao.protocolo.autor') }}
          {{ v.autor }} · {{ t('classificacao.protocolo.aprovador') }} {{ v.aprovador ?? '—' }}
          <SanteBotao
            variante="texto"
            :rotulo="t('classificacao.protocolo.abrir')"
            :data-testid="`abrir-versao-${v.id}`"
            @acionar="escolhida = v.id"
          />
        </li>
      </ul>
    </section>
    <section
      v-if="versao.data.value"
      class="painel"
      aria-labelledby="protocolo-detalhe"
      data-testid="protocolo-detalhe"
    >
      <h2 id="protocolo-detalhe">
        {{ versao.data.value.versao.nome }} ·
        {{ t('classificacao.protocolo.versao', { n: versao.data.value.versao.versao }) }}
      </h2>
      <p class="secundario">{{ versao.data.value.notas }}</p>
      <p v-if="versao.data.value.conteudo.licenca" class="secundario">
        {{ t('classificacao.protocolo.licenca') }}: {{ versao.data.value.conteudo.licenca.registro }} ·
        {{
          t('classificacao.protocolo.licencaValida', { data: versao.data.value.conteudo.licenca.validaAte })
        }}
      </p>
      <p class="secundario">
        {{ t('classificacao.protocolo.impressao') }}: {{ versao.data.value.versao.impressao }}
      </p>
      <h3>{{ t('classificacao.protocolo.cores') }}</h3>
      <ul class="lista-simples">
        <li v-for="c in versao.data.value.conteudo.cores" :key="c.cor">
          <MarcaRisco :cor="c.cor" :nome="c.nome" /> · {{ t('classificacao.protocolo.tempoAlvo') }}
          {{ c.tempoAlvoMin }} · {{ t('classificacao.protocolo.opcaoProntuario') }}:
          {{ c.opcaoE08 ?? t('classificacao.protocolo.semOpcao') }}
        </li>
      </ul>
      <h3>{{ t('classificacao.protocolo.fluxogramas') }}</h3>
      <div v-for="f in versao.data.value.conteudo.fluxogramas" :key="f.codigo">
        <h4>{{ f.titulo }}</h4>
        <ul class="lista-simples">
          <li
            v-for="d in versao.data.value.conteudo.discriminadores.filter((x) => x.fluxograma === f.codigo)"
            :key="d.codigo"
          >
            <MarcaRisco :cor="d.cor" /> {{ d.titulo }} ·
            {{
              regraTexto(d.regra)
                ? t('classificacao.protocolo.regraAutomatica', { regra: regraTexto(d.regra) })
                : t('classificacao.protocolo.regraManual')
            }}
          </li>
        </ul>
      </div>
    </section>
    <section
      v-if="podePublicar"
      class="painel"
      aria-labelledby="protocolo-editor"
      data-testid="protocolo-editor"
    >
      <h2 id="protocolo-editor">{{ t('classificacao.protocolo.editor') }}</h2>
      <p class="secundario">{{ t('classificacao.protocolo.editorTexto') }}</p>
      <p class="acoes">
        <SanteBotao
          v-if="versao.data.value"
          variante="secundario"
          :rotulo="t('classificacao.protocolo.partirDe')"
          data-testid="partir-vigente"
          @acionar="partirDe(versao.data.value.conteudo)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('classificacao.protocolo.partirDoExemplo')"
          data-testid="partir-exemplo"
          @acionar="partirDe(PROTOCOLO_SINTETICO)"
        />
      </p>
      <EditorProtocolo v-if="rascunho" v-model="rascunho" />
      <SanteAlerta
        v-if="problemaDoRascunho"
        variante="alerta"
        :texto="t('classificacao.protocolo.rascunhoIncompleto', { problema: problemaDoRascunho })"
        data-testid="protocolo-incompleto"
      />
      <details v-if="rascunho" class="painel" data-testid="protocolo-avancado">
        <summary>{{ t('classificacao.protocolo.visaoAvancada') }}</summary>
        <p class="secundario">{{ t('classificacao.protocolo.visaoAvancadaTexto') }}</p>
        <div class="campo">
          <label for="protocolo-json">{{ t('classificacao.protocolo.conteudo') }}</label>
          <textarea
            id="protocolo-json"
            v-model="texto"
            rows="14"
            spellcheck="false"
            data-testid="protocolo-json"
          ></textarea>
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="t('classificacao.protocolo.aplicarAvancado')"
          data-testid="protocolo-aplicar-json"
          @acionar="aplicarAvancado()"
        />
        <SanteAlerta
          v-if="textoInvalido"
          variante="alerta"
          :texto="t('classificacao.protocolo.conteudoInvalido')"
        />
      </details>
      <section
        v-if="conteudo"
        class="painel"
        aria-labelledby="protocolo-diferenca-titulo"
        data-testid="protocolo-diferenca"
      >
        <h3 id="protocolo-diferenca-titulo">
          {{
            vigenteConteudo
              ? t('classificacao.protocolo.diferencaTitulo')
              : t('classificacao.protocolo.diferencaSemVigente')
          }}
        </h3>
        <p v-if="diferenca.length === 0" class="secundario">
          {{ t('classificacao.protocolo.diferencaNenhuma') }}
        </p>
        <ul v-else-if="vigenteConteudo" class="lista-simples">
          <li
            v-for="d in diferenca"
            :key="`${d.parte}-${d.codigo}-${d.acao}`"
            :data-testid="`dif-${d.parte}-${d.codigo}`"
          >
            {{
              t(`classificacao.protocolo.diferencaAcao.${d.acao}`, {
                parte: t(`classificacao.protocolo.diferencaParte.${d.parte}`),
                titulo: d.titulo,
              })
            }}<template v-if="d.campos.length">
              ({{
                d.campos.map((c) => t(`classificacao.protocolo.diferencaCampo.${c}`)).join(', ')
              }})</template
            >
          </li>
        </ul>
        <p v-else class="secundario">
          {{ t('classificacao.protocolo.diferencaTotal', { n: diferenca.length }) }}
        </p>
      </section>
      <fieldset v-if="conteudo" class="painel" data-testid="protocolo-simulador">
        <legend>{{ t('classificacao.protocolo.simulacao') }}</legend>
        <SanteSelecao
          v-model="fluxoSimulado"
          :rotulo="t('classificacao.protocolo.fluxogramaSimulado')"
          :opcoes="opcoesFluxo"
          :busca="true"
          data-testid="simular-fluxograma"
        />
        <div class="grade-sinais">
          <div v-for="k in Object.keys(sinaisSimulados)" :key="k" class="campo">
            <label :for="`sim-${k}`">{{ t(`classificacao.tela.${k}`) }}</label>
            <input
              :id="`sim-${k}`"
              v-model="sinaisSimulados[k]"
              inputmode="decimal"
              :data-testid="`sim-${k}`"
            />
          </div>
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="t('classificacao.protocolo.simular')"
          :desabilitado="!fluxoSimulado"
          data-testid="simular"
          @acionar="simular()"
        />
        <template v-if="simulacao">
          <p data-testid="simulacao-resultado">
            <MarcaRisco :cor="simulacao.cor" :nome="simulacao.nomeCor" />
            {{
              t('classificacao.protocolo.resultado', {
                cor: t(`classificacao.cores.${simulacao.cor}`),
                nome: simulacao.nomeCor,
                min: simulacao.tempoAlvoMin,
              })
            }}
          </p>
          <ul v-if="simulacao.presentes.length" class="lista-simples">
            <li v-for="p in simulacao.presentes" :key="p.codigo">{{ p.titulo }}</li>
          </ul>
          <SanteAlerta
            v-if="simulacao.problemas.length === 0"
            variante="info"
            :texto="t('classificacao.protocolo.semProblemas')"
          />
          <ul v-else class="lista-simples" data-testid="simulacao-problemas">
            <li v-for="p in simulacao.problemas" :key="`${p.codigo}-${p.onde}`">{{ p.mensagem }}</li>
          </ul>
        </template>
      </fieldset>
      <div class="campo">
        <label for="protocolo-autor">{{ t('classificacao.protocolo.autorDaVersao') }}</label>
        <span id="protocolo-autor-ajuda" class="secundario">{{
          t('classificacao.protocolo.autorAjuda')
        }}</span>
        <input
          id="protocolo-autor"
          v-model="autor"
          maxlength="31"
          autocomplete="off"
          aria-describedby="protocolo-autor-ajuda"
          data-testid="protocolo-autor"
        />
      </div>
      <div class="campo">
        <label for="protocolo-notas">{{ t('classificacao.protocolo.notas') }}</label>
        <textarea
          id="protocolo-notas"
          v-model="notas"
          rows="2"
          maxlength="1000"
          data-testid="protocolo-notas"
        ></textarea>
      </div>
      <div class="campo">
        <label for="protocolo-senha">{{ t('classificacao.protocolo.senha') }}</label>
        <input
          id="protocolo-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          data-testid="protocolo-senha"
        />
      </div>
      <SanteBotao
        :rotulo="t('classificacao.protocolo.publicar')"
        :desabilitado="!prontoPublicar || ocupado"
        data-testid="protocolo-publicar"
        @acionar="publicar()"
      />
      <p v-if="mensagem" role="status" data-testid="protocolo-mensagem">{{ mensagem }}</p>
      <ErroClassificacao v-if="erro" :erro="erro" />
    </section>
    <!-- M44 (etapa 3): as definições dos protocolos gerenciados (o mesmo item da árvore). -->
    <DefinicoesGerenciadas />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
:deep(.tabela-simples input) {
  max-width: 12rem;
}
#protocolo-json {
  width: 100%;
  font-family: monospace;
}
</style>
