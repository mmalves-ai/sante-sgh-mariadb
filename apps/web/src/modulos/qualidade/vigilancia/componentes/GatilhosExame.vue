<script setup lang="ts">
// Os exames cujo resultado reagente sugere o agravo (D-EXAME-48.4): o trecho do nome do exame, a exceção, o CID e a
// situação. Sem configuração do estabelecimento vale a lista padrão; ao incluir o primeiro exame, a configuração
// substitui a padrão (a tela avisa). Incluir e alterar vão com a versão lida.
import { SanteBotao, SanteCampoTexto, SanteOpcoes } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  configurarGatilhoExame,
  type GatilhoExameTela,
  lerGatilhosExame,
  novaChaveAgravo,
} from '../api-agravo.js';
import { montarGatilhoExame } from '../regras-agravo.js';
import ErroAgravo from './ErroAgravo.vue';
import ErrosDoFormulario from './ErrosDoFormulario.vue';

const props = defineProps<{ podeNotificar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['agravos', 'gatilhos-exame'], queryFn: lerGatilhosExame });
const soPadrao = computed(() => (lista.data.value?.itens ?? []).every((g) => g.fonte === 'padrao'));

const editando = ref(false);
const f = reactive({
  gatilho: null as number | null,
  versao: null as number | null,
  padrao: '',
  exceto: '',
  cid: '',
  ativo: 'sim',
});
const opAtivo = [
  { valor: 'sim', rotulo: t('agravos.exames.ativo') },
  { valor: 'nao', rotulo: t('agravos.exames.inativo') },
];
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChaveAgravo('exame');

function editar(g: GatilhoExameTela | null): void {
  Object.assign(f, {
    gatilho: g?.fonte === 'configurado' ? g.id : null,
    versao: g?.fonte === 'configurado' ? g.versao : null,
    padrao: g?.padrao ?? '',
    exceto: g?.exceto ?? '',
    cid: g?.cid ?? '',
    ativo: g && !g.ativo ? 'nao' : 'sim',
  });
  erros.value = {};
  erro.value = null;
  aviso.value = null;
  editando.value = true;
}
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarGatilhoExame({ ...f, ativo: f.ativo === 'sim' });
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    await configurarGatilhoExame(m.entrada, chave);
    chave = novaChaveAgravo('exame');
    editando.value = false;
    aviso.value = t('agravos.exames.gravado');
    await cliente.invalidateQueries({ queryKey: ['agravos'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="agravo-exames-titulo" data-testid="gatilhos-exame">
    <h2 id="agravo-exames-titulo">{{ t('agravos.exames.titulo') }}</h2>
    <p class="secundario">{{ t('agravos.exames.explicacao') }}</p>
    <div v-if="aviso" role="status" data-testid="exames-aviso">{{ aviso }}</div>
    <ErroAgravo v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('agravos.carregando') }}</p>
    <table v-else class="tabela" data-testid="tabela-exames">
      <caption>
        {{
          t('agravos.exames.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('agravos.exames.colPadrao') }}</th>
          <th scope="col">{{ t('agravos.exames.colExceto') }}</th>
          <th scope="col">{{ t('agravos.exames.colCid') }}</th>
          <th scope="col">{{ t('agravos.exames.colAtivo') }}</th>
          <th scope="col">{{ t('agravos.exames.colFonte') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(g, i) in lista.data.value.itens"
          :key="`${g.fonte}-${g.id ?? i}-${g.padrao}`"
          :data-testid="`exame-${i}`"
        >
          <td>{{ g.padrao }}</td>
          <td>{{ g.exceto ?? '-' }}</td>
          <td>{{ g.cid }}</td>
          <td>
            <span :class="g.ativo ? 'selo selo--ok' : 'selo selo--neutro'">{{
              g.ativo ? t('agravos.exames.ativo') : t('agravos.exames.inativo')
            }}</span>
          </td>
          <td>
            {{ t(`agravos.exames.${g.fonte}`) }}
            <SanteBotao
              v-if="props.podeNotificar && g.fonte === 'configurado'"
              :rotulo="t('agravos.exames.alterar')"
              variante="texto"
              :data-testid="`exame-alterar-${i}`"
              @acionar="editar(g)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <SanteBotao
      v-if="props.podeNotificar && !editando"
      :rotulo="t('agravos.exames.novo')"
      variante="secundario"
      data-testid="exame-novo"
      @acionar="editar(null)"
    />
    <form v-if="editando" class="painel-ccih" data-testid="form-exame" @submit.prevent="gravar">
      <p v-if="soPadrao && f.gatilho === null" class="secundario" data-testid="exames-aviso-padrao">
        {{ t('agravos.exames.avisoPadrao') }}
      </p>
      <div class="linha-ccih">
        <SanteCampoTexto
          v-model="f.padrao"
          :rotulo="t('agravos.exames.colPadrao')"
          :max-bytes="40"
          obrigatorio
          data-testid="exame-padrao"
        />
        <SanteCampoTexto
          v-model="f.exceto"
          :rotulo="t('agravos.exames.colExceto')"
          :max-bytes="40"
          data-testid="exame-exceto"
        />
        <SanteCampoTexto
          v-model="f.cid"
          :rotulo="t('agravos.exames.colCid')"
          :max-bytes="5"
          obrigatorio
          data-testid="exame-cid"
        />
      </div>
      <SanteOpcoes
        v-model="f.ativo"
        :legenda="t('agravos.exames.colAtivo')"
        nome="exame-ativo"
        :opcoes="opAtivo"
        data-testid="exame-ativo"
      />
      <ErrosDoFormulario :erros="erros" />
      <ErroAgravo v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteBotao
          tipo="submit"
          :rotulo="t('agravos.gravar')"
          :desabilitado="gravando"
          data-testid="exame-gravar"
        />
        <SanteBotao :rotulo="t('agravos.cancelar')" variante="texto" @acionar="editando = false" />
      </div>
    </form>
  </section>
</template>
