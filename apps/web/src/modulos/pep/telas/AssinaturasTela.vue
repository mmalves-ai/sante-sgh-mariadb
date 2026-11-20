<script setup lang="ts">
// Pendências de assinatura (ficha do M23, regra 9): `/inicio/assinaturas`. Os documentos do profissional
// aguardando assinatura, a prévia exata de cada um (o hash mostrado é o que se assina) e a assinatura em lote; o
// aviso ao sair da sessão vem da mesma lista. Regra 3: os registros de residentes que aguardam a coassinatura deste
// preceptor (coassinar ou recusar com o motivo).
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { assinarLote, coassinar, lerPendencias, lerPrevia } from '../api-documentos.js';
import AvisoConsulta from '../componentes/documentos/AvisoConsulta.vue';
import { dataHoraBr } from '../formato.js';

const { t } = useI18n();
const cliente = useQueryClient();
const pend = useQuery({
  queryKey: ['pep', 'doc', 'assinaturas'],
  queryFn: () => lerPendencias(),
  staleTime: 0,
});
const marcados = ref<number[]>([]);
const senha = ref('');
const previaId = ref<number | null>(null);
const previa = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'previa', previaId.value]),
  queryFn: () => lerPrevia(previaId.value as number),
  enabled: computed(() => previaId.value !== null),
});
const visivel = computed({
  get: () => previaId.value !== null,
  set: (v) => (previaId.value = v ? previaId.value : null),
});
const resultado = ref<{
  assinados: readonly number[];
  recusados: readonly { documento: number; motivo: string }[];
} | null>(null);
const erro = ref<unknown>(null);
function todos(): void {
  marcados.value = pend.data.value?.itens.map((i) => i.documento) ?? [];
}
const motivoRecusa = ref('');
const coassinado = ref<{ id: number; aviso: string | null } | null>(null);
async function decidir(id: number, decisao: 'coassinado' | 'recusado'): Promise<void> {
  erro.value = null;
  try {
    const r = await coassinar(
      id,
      decisao === 'recusado' ? { decisao, motivo: motivoRecusa.value.trim() } : { decisao },
    );
    coassinado.value = {
      id,
      aviso: decisao === 'coassinado' && !r.campoSupervisao.pode ? r.campoSupervisao.motivo : null,
    };
    motivoRecusa.value = '';
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
async function assinar(): Promise<void> {
  erro.value = null;
  const itens = (pend.data.value?.itens ?? []).filter((i) => marcados.value.includes(i.documento));
  if (itens.length === 0) return;
  try {
    resultado.value = await assinarLote({
      documentos: itens.map((i) => i.documento),
      hashes: itens.map((i) => i.hash),
      ...(senha.value ? { senha: senha.value } : {}),
    });
    marcados.value = [];
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="assinaturas-titulo" data-testid="tela-assinaturas">
    <h1 id="assinaturas-titulo">{{ t('pep.doc.assinaturas.titulo') }}</h1>
    <p>{{ t('pep.doc.assinaturas.texto') }}</p>
    <!-- M49, etapa 2: a assinatura com certificado ICP-Brasil em lote (a política manda para receita de controle
         especial e atestado que sai do hospital). -->
    <p v-if="pode('documento.assinatura.assinar')" data-testid="link-assinatura-icp">
      <RouterLink to="/pep/assinaturas">{{ t('pep.doc.assinaturas.icp') }}</RouterLink>
    </p>
    <MensagemErro v-if="pend.isError.value" :erro="pend.error.value" />
    <p v-else-if="!pend.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="pend.data.value.total === 0"
        variante="info"
        :texto="t('pep.doc.assinaturas.vazio')"
      />
      <template v-else>
        <p role="status">{{ t('pep.doc.assinaturas.total', { n: pend.data.value.total }) }}</p>
        <AvisoConsulta :acao="pend.data.value.assinar" />
        <SanteBotao
          variante="texto"
          :rotulo="t('pep.doc.assinaturas.todos')"
          data-testid="assinar-todos"
          @acionar="todos"
        />
        <ul class="lista" data-testid="lista-pendencias">
          <li
            v-for="i in pend.data.value.itens"
            :key="i.documento"
            class="cartao linha"
            :data-testid="`pendencia-${i.documento}`"
          >
            <label class="marca">
              <input
                v-model="marcados"
                type="checkbox"
                :value="i.documento"
                :aria-label="t('pep.doc.assinaturas.selecionar', { titulo: i.titulo, nome: i.nome })"
              />
              <strong>{{ i.titulo }}</strong> · {{ i.nome }} · {{ dataHoraBr(i.emitidoEm) }}
            </label>
            <SanteBotao
              variante="texto"
              :rotulo="t('pep.doc.assinaturas.previa')"
              @acionar="previaId = i.documento"
            />
          </li>
        </ul>
        <form v-if="pend.data.value.assinar.pode" class="form" @submit.prevent="assinar">
          <label
            ><span>{{ t('pep.doc.senha') }}</span
            ><input v-model="senha" type="password" autocomplete="current-password"
          /></label>
          <SanteBotao
            tipo="submit"
            :rotulo="t('pep.doc.assinaturas.assinar', { n: marcados.length })"
            :desabilitado="marcados.length === 0"
            data-testid="assinar-lote"
          />
        </form>
      </template>
      <section
        v-if="pend.data.value.coassinaturas.length > 0"
        class="bloco"
        aria-labelledby="coassinaturas-titulo"
        data-testid="lista-coassinaturas"
      >
        <h2 id="coassinaturas-titulo">{{ t('pep.doc.assinaturas.coassinaturas') }}</h2>
        <ul class="lista">
          <li
            v-for="c in pend.data.value.coassinaturas"
            :key="c.id"
            class="cartao linha"
            :data-testid="`coassinatura-${c.id}`"
          >
            <span
              >{{ t('pep.doc.assinaturas.doResidente', { residente: c.residente }) }} · {{ c.nome }} ·
              {{ dataHoraBr(c.em) }}</span
            >
            <RouterLink :to="`/pep/${c.paciente}/registro/${c.registro}`">{{
              t('pep.doc.assinaturas.verRegistro')
            }}</RouterLink>
            <SanteBotao
              :rotulo="t('pep.doc.assinaturas.coassinar')"
              :data-testid="`coassinar-${c.id}`"
              @acionar="decidir(c.id, 'coassinado')"
            />
            <label
              ><span>{{ t('pep.doc.assinaturas.motivoRecusa') }}</span
              ><input v-model="motivoRecusa" maxlength="500"
            /></label>
            <SanteBotao
              variante="secundario"
              :rotulo="t('pep.doc.assinaturas.recusar')"
              :desabilitado="motivoRecusa.trim().length < 10"
              @acionar="decidir(c.id, 'recusado')"
            />
          </li>
        </ul>
      </section>
      <template v-if="coassinado">
        <p role="status" data-testid="coassinatura-feita">{{ t('pep.doc.assinaturas.coassinaturaFeita') }}</p>
        <SanteAlerta v-if="coassinado.aviso" variante="info" :texto="coassinado.aviso" />
      </template>
      <template v-if="resultado">
        <p role="status">{{ t('pep.doc.assinaturas.assinados', { n: resultado.assinados.length }) }}</p>
        <SanteAlerta
          v-for="r in resultado.recusados"
          :key="r.documento"
          variante="aviso"
          :texto="t('pep.doc.assinaturas.recusado', { motivo: r.motivo })"
        />
      </template>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="previa.data.value?.titulo ?? t('pep.doc.assinaturas.previa')"
      largura="48rem"
    >
      <MensagemErro v-if="previa.isError.value" :erro="previa.error.value" />
      <article v-else-if="previa.data.value" data-testid="previa-assinatura">
        <p v-for="(p, n) in previa.data.value.paragrafos" :key="n">{{ p }}</p>
        <p>{{ t('pep.doc.documento.prova', { hash: previa.data.value.hash }) }}</p>
      </article>
    </SanteDialogo>
  </section>
</template>

<style scoped src="./abas/abas.css"></style>
