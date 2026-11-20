<script setup lang="ts">
// POPs versionados (M52.6; regra 20; RDC63-05): os vigentes com a adesão (ciências dos alcançados), as versões de cada
// código com quem ainda não deu ciência, publicar o POP ou a versão nova (a anterior fica substituída e a ciência é
// pedida de novo) e revogar com motivo.
import { type ApoioTreinamento, esquemaVersaoPop, SITUACOES_POP } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import { lerPop, lerPops, publicarPop, revogarPop } from './api-f6.js';

const props = defineProps<{ apoio: ApoioTreinamento }>();
const { t } = useI18n();
const cliente = useQueryClient();
const pops = useQuery({ queryKey: ['f6', 'pops'], queryFn: lerPops });
const lista = computed(() => pops.data.value?.itens ?? null);
const codigoAberto = ref<string | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['f6', 'pop', codigoAberto.value]),
  queryFn: () => lerPop(codigoAberto.value!),
  enabled: computed(() => codigoAberto.value !== null),
});
const det = computed(() => detalhe.data.value ?? null);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

const publicando = ref(false);
const codigo = ref('');
const titulo = ref('');
const unidade = ref<number | null>(null);
const vigencia = ref<string | null>(props.apoio.hoje);
const resumo = ref('');
const referencia = ref('');
const alteracoes = ref('');
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('f6.treinamentos.pops.estabelecimento') },
  ...props.apoio.unidades.map((u) => ({ valor: u.codigo as number | null, rotulo: u.rotulo })),
]);
function novaVersao(
  base: {
    codigo: string;
    titulo: string;
    unidade: number | null;
    resumo: string;
    referencia: string | null;
  } | null,
): void {
  publicando.value = true;
  erro.value = null;
  codigo.value = base?.codigo ?? '';
  titulo.value = base?.titulo ?? '';
  unidade.value = base?.unidade ?? null;
  vigencia.value = props.apoio.hoje;
  resumo.value = base?.resumo ?? '';
  referencia.value = base?.referencia ?? '';
  alteracoes.value = '';
}
const entrada = computed(() =>
  esquemaVersaoPop.safeParse({
    codigo: codigo.value.trim().toUpperCase(),
    titulo: titulo.value.trim(),
    unidade: unidade.value,
    vigencia: vigencia.value ?? '',
    resumo: resumo.value.trim(),
    referencia: referencia.value.trim() || null,
    alteracoes: alteracoes.value.trim() || null,
  }),
);
async function publicar(): Promise<void> {
  if (!entrada.value.success) return;
  erro.value = null;
  try {
    aviso.value = (await publicarPop(entrada.value.data)).mensagem;
    publicando.value = false;
    codigoAberto.value = entrada.value.data.codigo;
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}
const revogando = ref<number | null>(null);
const motivo = ref('');
async function revogar(): Promise<void> {
  if (revogando.value === null || motivo.value.trim().length < 10) return;
  erro.value = null;
  try {
    aviso.value = (await revogarPop(revogando.value, motivo.value.trim())).mensagem;
    revogando.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['f6'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="treino-pops" data-testid="treino-pops">
    <h2 id="treino-pops">{{ t('f6.treinamentos.abas.pops') }}</h2>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pops-aviso" />
    <ErroPessoas v-if="pops.isError.value" :erro="pops.error.value" />
    <p v-else-if="!lista" role="status">{{ t('f6.carregando') }}</p>
    <p v-else-if="lista.length === 0">{{ t('f6.treinamentos.pops.semPops') }}</p>
    <table v-else class="tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('f6.treinamentos.pops.codigo') }}</th>
          <th scope="col">{{ t('f6.treinamentos.pops.tituloPop') }}</th>
          <th scope="col">{{ t('f6.treinamentos.pops.versao') }}</th>
          <th scope="col">{{ t('f6.treinamentos.pops.vigencia') }}</th>
          <th scope="col">{{ t('f6.treinamentos.pops.adesao') }}</th>
          <th scope="col"><span class="secundario">—</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in lista" :key="p.id" :data-testid="`pop-${p.codigo}`">
          <th scope="row">{{ p.codigo }}</th>
          <td>
            {{ p.titulo }}
            <div class="secundario">{{ p.unidadeNome ?? t('f6.treinamentos.pops.estabelecimento') }}</div>
          </td>
          <td>{{ p.versao }}</td>
          <td>{{ dataBr(p.vigencia) }}</td>
          <td>
            <template v-if="p.adesao">
              {{
                t('f6.treinamentos.pops.adesaoTexto', {
                  c: p.adesao.cientes,
                  a: p.adesao.alcancados,
                  p: p.adesao.percentual,
                })
              }}
            </template>
          </td>
          <td>
            <SanteBotao
              :rotulo="t('f6.abrir')"
              variante="texto"
              :data-testid="`abrir-pop-${p.codigo}`"
              @acionar="codigoAberto = p.codigo"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div class="acoes">
      <SanteBotao
        v-if="apoio.acoes.registrar && !publicando"
        :rotulo="t('f6.treinamentos.pops.novo')"
        data-testid="novo-pop"
        @acionar="novaVersao(null)"
      />
    </div>
  </section>

  <form
    v-if="publicando"
    class="bloco"
    :aria-label="t('f6.treinamentos.pops.novo')"
    data-testid="form-pop"
    @submit.prevent="publicar"
  >
    <h2>{{ t('f6.treinamentos.pops.novo') }}</h2>
    <div class="campos">
      <SanteCampoTexto
        v-model="codigo"
        :rotulo="t('f6.treinamentos.pops.codigo')"
        :max-bytes="20"
        data-testid="pop-codigo"
      />
      <SanteCampoTexto
        v-model="titulo"
        :rotulo="t('f6.treinamentos.pops.tituloPop')"
        :max-bytes="120"
        data-testid="pop-titulo"
      />
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('f6.treinamentos.pops.unidade')"
        :opcoes="opcoesUnidade"
        data-testid="pop-unidade"
      />
      <SanteData
        v-model="vigencia"
        :rotulo="t('f6.treinamentos.pops.vigencia')"
        editavel
        data-testid="pop-vigencia"
      />
    </div>
    <SanteCampoTexto
      v-model="resumo"
      :rotulo="t('f6.treinamentos.pops.resumo')"
      :max-bytes="2000"
      data-testid="pop-resumo"
    />
    <SanteCampoTexto
      v-model="referencia"
      :rotulo="t('f6.treinamentos.pops.referencia')"
      :max-bytes="200"
      data-testid="pop-referencia"
    />
    <SanteCampoTexto
      v-model="alteracoes"
      :rotulo="t('f6.treinamentos.pops.alteracoes')"
      :max-bytes="1000"
      data-testid="pop-alteracoes"
    />
    <ErroPessoas v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="publicando = false" />
      <SanteBotao
        :rotulo="t('f6.gravar')"
        tipo="submit"
        :desabilitado="!entrada.success"
        data-testid="pop-gravar"
      />
    </div>
  </form>

  <section v-if="codigoAberto" class="bloco" aria-labelledby="pop-detalhe" data-testid="pop-detalhe">
    <ErroPessoas v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!det" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <h2 id="pop-detalhe">{{ codigoAberto }}</h2>
      <h3>{{ t('f6.treinamentos.pops.versoes') }}</h3>
      <ul>
        <li v-for="v in det.versoes" :key="v.id" :data-testid="`pop-versao-${v.versao}`">
          {{ t('f6.treinamentos.pops.versao') }} {{ v.versao }} · {{ SITUACOES_POP[v.situacao] }} ·
          {{ dataBr(v.vigencia) }}
          <div class="secundario">{{ v.resumo }}</div>
          <div v-if="v.alteracoes" class="secundario">{{ v.alteracoes }}</div>
          <div v-if="v.motivo" class="secundario">{{ v.motivo }}</div>
          <div class="secundario">
            {{ t('f6.treinamentos.pops.publicado', { por: v.publicadoPor, em: dataBr(v.publicadoEm) }) }}
          </div>
          <div v-if="v.situacao === 'vigente' && apoio.acoes.registrar" class="acoes">
            <SanteBotao
              :rotulo="t('f6.treinamentos.pops.novo')"
              variante="secundario"
              :data-testid="`nova-versao-${v.codigo}`"
              @acionar="novaVersao(v)"
            />
            <SanteBotao
              :rotulo="t('f6.treinamentos.pops.revogar')"
              variante="texto"
              :data-testid="`revogar-${v.id}`"
              @acionar="revogando = v.id"
            />
          </div>
        </li>
      </ul>
      <form
        v-if="revogando !== null"
        class="bloco"
        :aria-label="t('f6.treinamentos.pops.revogar')"
        @submit.prevent="revogar"
      >
        <SanteAlerta :texto="t('f6.treinamentos.pops.revogarAviso')" variante="aviso" />
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('f6.motivo')"
          :max-bytes="400"
          data-testid="revogar-motivo"
        />
        <div class="acoes">
          <SanteBotao :rotulo="t('f6.cancelar')" variante="texto" @acionar="revogando = null" />
          <SanteBotao
            :rotulo="t('f6.treinamentos.pops.revogar')"
            tipo="submit"
            :desabilitado="motivo.trim().length < 10"
            data-testid="revogar-confirmar"
          />
        </div>
      </form>
      <h3>{{ t('f6.treinamentos.pops.pendentes') }}</h3>
      <p v-if="det.pendentes.length === 0">{{ t('f6.treinamentos.pops.todosCientes') }}</p>
      <ul v-else data-testid="pop-pendentes">
        <li v-for="x in det.pendentes" :key="x.vinculo">
          {{ x.nome }} <span class="secundario">{{ x.matricula ?? '' }} · {{ x.unidadeNome ?? '' }}</span>
        </li>
      </ul>
      <p v-if="det.limitado" class="secundario">{{ t('f6.limitado') }}</p>
      <ErroPessoas v-if="erro && !publicando" :erro="erro" />
      <div class="acoes">
        <SanteBotao :rotulo="t('f6.fechar')" variante="texto" @acionar="codigoAberto = null" />
      </div>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
