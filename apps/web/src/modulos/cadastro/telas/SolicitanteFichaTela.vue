<script setup lang="ts">
// Ficha do solicitante externo (F3.1, 02-CAD linha 20): dados editáveis (o registro no conselho fica), o que falta
// para a guia, os cadastros parecidos (regra do domínio), inativar e reativar com o motivo (nunca apagar) e o código
// do solicitante em cada fonte pagadora. Tudo numa tela só; a recusa da API aparece junto do campo.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarSolicitante,
  gravarCodigoNaFonte,
  lerFichaSolicitante,
  mudarSituacaoSolicitante,
} from '../api-ligacoes.js';
import { lerOpcoes } from '../api-vinculos.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const editar = computed(() => pode('cadastro.solicitante.editar'));
const chaveQ = computed(() => ['cadastro', 'solicitante', props.id]);
const consulta = useQuery({ queryKey: chaveQ, queryFn: () => lerFichaSolicitante(Number(props.id)) });
const f = computed(() => consulta.data.value);
const fontes = useQuery({ queryKey: ['cadastro', 'vinculos-opcoes'], queryFn: lerOpcoes, enabled: editar });
const CAMPOS = [
  'nome',
  'conselho',
  'uf',
  'numero',
  'cpf',
  'cns',
  'instituicaoNome',
  'instituicaoCnes',
  'telefone',
  'email',
  'observacao',
] as const;
const dados = ref<Record<string, string>>({});
watch(
  f,
  (x) => {
    if (x) dados.value = Object.fromEntries(CAMPOS.map((c) => [c, String(x[c] ?? '')]));
  },
  { immediate: true },
);
const motivo = ref('');
const fonte = ref<number | null>(null);
const codigo = ref('');
const erro = ref<unknown>(null);
const ok = ref(false);

async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ok.value = false;
  try {
    await fn();
    ok.value = true;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
const gravarDados = () =>
  fazer(() =>
    alterarSolicitante(Number(props.id), {
      ...dados.value,
      versao: f.value!.versao,
      ocupacao: f.value!.ocupacao,
      especialidade: f.value!.especialidade,
      instituicaoCnpj: f.value!.instituicaoCnpj,
    }),
  );
</script>

<template>
  <div class="tela" data-testid="tela-solicitante">
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-if="f">
      <h1>{{ t('ligacoes.solicitante.titulo') }}: {{ f.nome }}</h1>
      <p>
        {{ t('ligacoes.solicitante.registro') }}: {{ f.conselho }} {{ f.numero }}/{{ f.uf }}
        <span v-if="!f.ativo" class="pilula pilula--neutra" data-testid="solicitante-inativo">
          {{ t('ligacoes.solicitante.inativo', { data: f.dataInativacao ?? '' }) }}
        </span>
      </p>
      <p v-if="f.faltaParaGuia.length" class="aviso" data-testid="solicitante-falta-guia">
        {{ t('ligacoes.solicitante.faltaGuia', { campos: f.faltaParaGuia.join(', ') }) }}
      </p>
      <MensagemErro v-if="erro" :erro="erro" data-testid="solicitante-erro" />
      <p v-if="ok" role="status">{{ t('ligacoes.comum.gravado') }}</p>

      <section aria-labelledby="sol-dados">
        <h2 id="sol-dados">{{ t('ligacoes.solicitante.dados') }}</h2>
        <form class="barra" @submit.prevent="gravarDados">
          <div v-for="c in CAMPOS" :key="c" class="campo">
            <label :for="`sol-${c}`">{{
              t(
                `ligacoes.solicitante.${c === 'instituicaoNome' ? 'instituicao' : c === 'instituicaoCnes' ? 'cnes' : c}`,
              )
            }}</label>
            <input :id="`sol-${c}`" v-model="dados[c]" :disabled="!editar" :data-testid="`sol-${c}`" />
          </div>
          <SanteBotao
            v-if="editar"
            :rotulo="t('ligacoes.comum.gravar')"
            tipo="submit"
            data-testid="sol-gravar"
          />
        </form>
      </section>

      <section v-if="editar" aria-labelledby="sol-situacao">
        <h2 id="sol-situacao">
          {{ f.ativo ? t('ligacoes.solicitante.inativar') : t('ligacoes.solicitante.reativar') }}
        </h2>
        <div class="campo">
          <label for="sol-motivo">{{ t('ligacoes.solicitante.motivo') }}</label>
          <input id="sol-motivo" v-model="motivo" maxlength="200" data-testid="sol-motivo" />
        </div>
        <SanteBotao
          :rotulo="f.ativo ? t('ligacoes.solicitante.inativar') : t('ligacoes.solicitante.reativar')"
          :variante="f.ativo ? 'destrutivo' : 'secundario'"
          :confirmacao="f.ativo ? t('ligacoes.solicitante.inativar') : ''"
          :desabilitado="motivo.trim().length < 10"
          data-testid="sol-situacao"
          @acionar="
            fazer(() => mudarSituacaoSolicitante(Number(id), { versao: f!.versao, ativo: !f!.ativo, motivo }))
          "
        />
      </section>

      <section aria-labelledby="sol-parecidos">
        <h2 id="sol-parecidos">{{ t('ligacoes.solicitante.parecidos') }}</h2>
        <p v-if="f.parecidos.length === 0">{{ t('ligacoes.solicitante.semParecidos') }}</p>
        <ul v-else data-testid="sol-lista-parecidos">
          <li v-for="p in f.parecidos" :key="p.id">
            <RouterLink :to="`/cadastros/solicitantes/${p.id}`">{{ p.nome }}</RouterLink>
            — {{ p.registro }} ({{ t(`ligacoes.solicitante.motivos.${p.motivo}`) }})
          </li>
        </ul>
      </section>

      <section aria-labelledby="sol-codigos">
        <h2 id="sol-codigos">{{ t('ligacoes.solicitante.codigos') }}</h2>
        <p v-if="f.codigos.length === 0">{{ t('ligacoes.comum.nenhum') }}</p>
        <ul v-else data-testid="sol-lista-codigos">
          <li v-for="c in f.codigos" :key="c.id">
            {{ c.fonteNome }}: {{ c.codigo }}
            <span v-if="!c.ativo" class="pilula pilula--neutra">{{ t('ligacoes.comum.encerrada') }}</span>
            <SanteBotao
              v-if="editar && c.ativo"
              :rotulo="t('ligacoes.solicitante.inativarCodigo')"
              variante="secundario"
              @acionar="
                fazer(() =>
                  gravarCodigoNaFonte(Number(id), { fonte: c.fonte, codigo: c.codigo, ativo: false }),
                )
              "
            />
          </li>
        </ul>
        <form
          v-if="editar"
          class="barra"
          @submit.prevent="
            fazer(() => gravarCodigoNaFonte(Number(id), { fonte: fonte!, codigo, ativo: true }))
          "
        >
          <div class="campo">
            <label for="sol-fonte">{{ t('ligacoes.solicitante.fonte') }}</label>
            <select id="sol-fonte" v-model="fonte" data-testid="sol-fonte">
              <option :value="null">{{ t('ligacoes.comum.escolha') }}</option>
              <option v-for="x in fontes.data.value?.fontes ?? []" :key="x.id" :value="x.id">
                {{ x.nome }}
              </option>
            </select>
          </div>
          <div class="campo">
            <label for="sol-codigo">{{ t('ligacoes.solicitante.codigo') }}</label>
            <input
              id="sol-codigo"
              v-model="codigo"
              maxlength="20"
              pattern="[0-9A-Za-z./\-]+"
              data-testid="sol-codigo"
            />
          </div>
          <SanteBotao
            :rotulo="t('ligacoes.comum.gravar')"
            tipo="submit"
            :desabilitado="fonte === null || !codigo.trim()"
            data-testid="sol-gravar-codigo"
          />
        </form>
      </section>
    </template>
  </div>
</template>
