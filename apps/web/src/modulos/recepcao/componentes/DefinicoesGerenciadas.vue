<script setup lang="ts">
// Definições dos protocolos gerenciados (ficha do M44, seção 7: "Protocolos de classificação e gerenciados"; etapa 3):
// as versões publicadas de sepse, dor torácica, AVC e trauma (critérios, metas com prazo e checklist), a vigente
// marcada; a diretoria clínica publica a versão nova pelo editor estruturado (critérios, metas e checklist por linha,
// partindo da vigente ou do modelo de teste), com o autor (outra pessoa) e a senha. A versão publicada não muda.
import {
  CODIGOS_TIPO_GERENCIADO,
  type ConteudoGerenciado,
  esquemaConteudoGerenciado,
  type TipoProtocoloGerenciado,
} from '@sgh/contratos';
import { PROTOCOLOS_GERENCIADOS_SINTETICOS } from '@sgh/dominio-recepcao';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';
import {
  lerDefinicoesGerenciadas,
  novaChaveClassificacao,
  publicarDefinicaoGerenciada,
} from '../api-classificacao.js';
import { horaDe, dataDe } from '../formato.js';
import ErroClassificacao from './ErroClassificacao.vue';

const { t } = useI18n();
const definicoes = useQuery({
  queryKey: ['protocolos', 'definicoes'],
  queryFn: () => lerDefinicoesGerenciadas(),
});
const podePublicar = computed(() => pode('recepcao.protocolo.publicar'));

// O atalho do relógio abre `/administracao/pa/protocolos#gerenciados`: a seção fica no fim da tela de protocolos, e o
// roteador não rola até a âncora; quando as definições chegam, a tela leva o usuário até elas (uma vez por entrada).
const rota = useRoute();
let rolou = false;
watch(
  () => [definicoes.data.value, rota.hash] as const,
  async ([d, hash]) => {
    if (rolou || !d || hash !== '#gerenciados') return;
    rolou = true;
    await nextTick();
    document.getElementById('gerenciados')?.scrollIntoView({ block: 'start' });
  },
  { immediate: true },
);

const tipo = ref<TipoProtocoloGerenciado>('dor-toracica');
const opcoesTipo = computed(() =>
  CODIGOS_TIPO_GERENCIADO.map((x) => ({ valor: x, rotulo: t(`protocolos.tipos.${x}`) })),
);
const rascunho = ref<ConteudoGerenciado | null>(null);
const autor = ref('');
const notas = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const invalido = ref(false);

const copia = (c: ConteudoGerenciado): ConteudoGerenciado =>
  JSON.parse(JSON.stringify(c)) as ConteudoGerenciado;
function partirDaVigente(): void {
  const v = (definicoes.data.value ?? []).find((x) => x.versao.tipo === tipo.value && x.versao.vigente);
  rascunho.value = copia(
    v?.conteudo ?? PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === tipo.value)!,
  );
}
function partirDoModelo(): void {
  rascunho.value = copia(PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === tipo.value)!);
}
const codigoDe = (titulo: string, i: number) =>
  (
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || `item-${i + 1}`
  ).replace(/^(\d)/, 'i$1');
function novaMeta(): void {
  rascunho.value?.metas.push({
    codigo: `meta-${rascunho.value.metas.length + 1}`,
    titulo: '',
    prazoMin: 60,
    desde: 'inclusao',
  });
}
function novoCriterio(): void {
  rascunho.value?.criterios.push({ codigo: `criterio-${rascunho.value.criterios.length + 1}`, titulo: '' });
}
function novoItem(): void {
  rascunho.value?.checklist.push({ codigo: `item-${rascunho.value.checklist.length + 1}`, titulo: '' });
}
const opcoesDesde = computed(() => [
  { valor: 'chegada', rotulo: t('protocolos.definicoes.desde.chegada') },
  { valor: 'inclusao', rotulo: t('protocolos.definicoes.desde.inclusao') },
]);

async function publicar(): Promise<void> {
  if (!rascunho.value) return;
  const c = copia(rascunho.value);
  // Código das linhas novas pelo título (único na versão).
  c.criterios = c.criterios.map((x, i) => ({
    ...x,
    codigo: x.codigo.startsWith('criterio-') ? codigoDe(x.titulo, i) : x.codigo,
  }));
  c.checklist = c.checklist.map((x, i) => ({
    ...x,
    codigo: x.codigo.startsWith('item-') ? codigoDe(x.titulo, i) : x.codigo,
  }));
  c.metas = c.metas.map((x, i) => ({
    ...x,
    codigo: x.codigo.startsWith('meta-') ? codigoDe(x.titulo, i) : x.codigo,
  }));
  c.tipo = tipo.value;
  const ok = esquemaConteudoGerenciado.safeParse(c);
  invalido.value = !ok.success;
  if (!ok.success) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await publicarDefinicaoGerenciada(
      { autor: autor.value.trim(), conteudo: ok.data, notas: notas.value.trim(), senha: senha.value },
      novaChaveClassificacao('publicar-gerenciado'),
    );
    mensagem.value = r.mensagem;
    rascunho.value = null;
    senha.value = '';
    await definicoes.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    id="gerenciados"
    class="painel"
    aria-labelledby="gerenciados-titulo"
    data-testid="definicoes-gerenciadas"
  >
    <h2 id="gerenciados-titulo">{{ t('protocolos.definicoes.titulo') }}</h2>
    <p>{{ t('protocolos.definicoes.texto') }}</p>
    <ErroClassificacao v-if="definicoes.isError.value" :erro="definicoes.error.value" />
    <p v-else-if="!definicoes.data.value" role="status">{{ t('protocolos.carregando') }}</p>
    <template v-else>
      <p v-if="definicoes.data.value.length === 0">{{ t('protocolos.definicoes.nenhuma') }}</p>
      <article
        v-for="v in definicoes.data.value"
        :key="v.versao.id"
        class="cartao"
        :data-testid="`definicao-${v.versao.tipo}-${v.versao.versao}`"
      >
        <h3>
          {{
            t('protocolos.definicoes.versao', {
              tipo: t(`protocolos.tipos.${v.versao.tipo}`),
              versao: v.versao.versao,
            })
          }}
          <strong v-if="v.versao.vigente"> · {{ t('protocolos.definicoes.vigente') }}</strong>
        </h3>
        <p class="secundario">
          {{
            t('protocolos.definicoes.publicadaPor', {
              em: `${dataDe(v.versao.publicadoEm)} ${horaDe(v.versao.publicadoEm)}`,
              aprovador: v.versao.aprovador,
              autor: v.versao.autor,
            })
          }}
        </p>
        <p>{{ v.conteudo.nome }} · {{ v.notas }}</p>
        <h4>{{ t('protocolos.definicoes.metas') }}</h4>
        <ul class="lista">
          <li v-for="m in v.conteudo.metas" :key="m.codigo">
            {{
              t('protocolos.definicoes.metaLinha', {
                titulo: m.titulo,
                min: m.prazoMin,
                desde: t(`protocolos.definicoes.desde.${m.desde}`),
              })
            }}
          </li>
        </ul>
        <h4>{{ t('protocolos.definicoes.criterios') }}</h4>
        <ul class="lista">
          <li v-for="c in v.conteudo.criterios" :key="c.codigo">{{ c.titulo }}</li>
        </ul>
        <template v-if="v.conteudo.checklist.length > 0">
          <h4>{{ t('protocolos.definicoes.checklist') }}</h4>
          <ul class="lista">
            <li v-for="c in v.conteudo.checklist" :key="c.codigo">{{ c.titulo }}</li>
          </ul>
        </template>
      </article>
    </template>

    <template v-if="podePublicar">
      <h3>{{ t('protocolos.definicoes.nova') }}</h3>
      <SanteSelecao
        v-model="tipo"
        data-testid="gerenciado-tipo"
        :rotulo="t('protocolos.incluir.tipo')"
        :opcoes="opcoesTipo"
      />
      <p class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('protocolos.definicoes.nova')"
          data-testid="gerenciado-partir-vigente"
          @acionar="partirDaVigente"
        />
        <SanteBotao variante="texto" :rotulo="t('protocolos.definicoes.modelo')" @acionar="partirDoModelo" />
      </p>
      <form v-if="rascunho" class="painel" data-testid="form-gerenciado" @submit.prevent="publicar">
        <SanteCampoTexto
          v-model="rascunho.nome"
          :rotulo="t('protocolos.definicoes.conteudo')"
          :max-bytes="80"
        />
        <fieldset>
          <legend>{{ t('protocolos.definicoes.metas') }}</legend>
          <div v-for="(m, i) in rascunho.metas" :key="i" class="linha-meta">
            <SanteCampoTexto
              v-model="m.titulo"
              :rotulo="`${t('protocolos.adesao.meta')} ${i + 1}`"
              :max-bytes="120"
            />
            <label
              >{{ t('protocolos.definicoes.prazoMin') }}
              <input v-model.number="m.prazoMin" type="number" min="1" max="1440" :data-testid="`prazo-${i}`"
            /></label>
            <SanteSelecao
              v-model="m.desde"
              :rotulo="t('protocolos.definicoes.desdeRotulo')"
              :opcoes="opcoesDesde"
            />
          </div>
          <SanteBotao variante="texto" :rotulo="`+ ${t('protocolos.adesao.meta')}`" @acionar="novaMeta" />
        </fieldset>
        <fieldset>
          <legend>{{ t('protocolos.definicoes.criterios') }}</legend>
          <SanteCampoTexto
            v-for="(c, i) in rascunho.criterios"
            :key="i"
            v-model="c.titulo"
            :rotulo="`${t('protocolos.definicoes.criterios')} ${i + 1}`"
            :max-bytes="160"
          />
          <SanteBotao
            variante="texto"
            :rotulo="`+ ${t('protocolos.definicoes.criterios')}`"
            @acionar="novoCriterio"
          />
        </fieldset>
        <fieldset>
          <legend>{{ t('protocolos.definicoes.checklist') }}</legend>
          <SanteCampoTexto
            v-for="(c, i) in rascunho.checklist"
            :key="i"
            v-model="c.titulo"
            :rotulo="`${t('protocolos.definicoes.checklist')} ${i + 1}`"
            :max-bytes="160"
          />
          <SanteBotao
            variante="texto"
            :rotulo="`+ ${t('protocolos.definicoes.checklist')}`"
            @acionar="novoItem"
          />
        </fieldset>
        <SanteCampoTexto
          v-model="autor"
          data-testid="gerenciado-autor"
          :rotulo="t('protocolos.definicoes.autor')"
          :max-bytes="31"
        />
        <SanteCampoTexto
          v-model="notas"
          :rotulo="t('protocolos.definicoes.notas')"
          :max-bytes="1000"
          multilinha
        />
        <label
          >{{ t('protocolos.definicoes.senha') }}
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="gerenciado-senha"
        /></label>
        <SanteAlerta v-if="invalido" variante="alerta" :texto="t('protocolos.definicoes.jsonInvalido')" />
        <ErroClassificacao v-if="erro" :erro="erro" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('protocolos.definicoes.publicar')"
          :desabilitado="ocupado || !autor || !senha || notas.trim().length < 3"
          data-testid="gerenciado-publicar"
        />
      </form>
      <p v-if="mensagem" role="status" data-testid="gerenciado-mensagem">{{ mensagem }}</p>
    </template>
  </section>
</template>
