<script setup lang="ts">
// Aba "Tabela salarial" da ficha do cargo (W0-06, parte 4b): as faixas por faixa e nível em todas as versões (a em
// vigor e as encerradas, com o motivo), a inclusão de faixa e nível, o novo valor a partir de uma data (versão nova;
// a anterior termina na véspera) e a inativação, a reativação e a exclusão do lançado por engano (pela tela-mãe).
import type { AlvoCargos, FichaCargo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { incluirFaixa, versaoFaixa } from './api-cargos.js';
import { centavosDe, reais } from './cargos-comum.js';

type Alvo = { alvo: AlvoCargos; id: number; versao: number };
const props = defineProps<{ ficha: FichaCargo; hoje: string; pode: boolean }>();
const emit = defineEmits<{
  gravado: [r: unknown];
  situacao: [x: Alvo & { ativo: boolean }];
  excluir: [x: Alvo];
}>();
const { t } = useI18n();

const faixa = ref('');
const nivel = ref('');
const valor = ref('');
const desde = ref<string | null>(props.hoje);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function incluir(): Promise<void> {
  erro.value = null;
  const v = centavosDe(valor.value);
  aviso.value = v === null ? t('pessoas.cargos.faixas.valorInvalido') : null;
  if (v === null || !desde.value) return;
  ocupado.value = true;
  try {
    const r = await incluirFaixa({
      cargo: props.ficha.cargo.id,
      faixa: faixa.value,
      nivel: nivel.value,
      valor: v,
      desde: desde.value,
    });
    faixa.value = '';
    nivel.value = '';
    valor.value = '';
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// Novo valor (versão): o diálogo do motivo com o valor e a data no slot.
const dialogo = ref(false);
const alvo = ref<{ id: number; versao: number } | null>(null);
const novoValor = ref('');
const novoDesde = ref<string | null>(null);
function pedirVersao(id: number, versao: number): void {
  alvo.value = { id, versao };
  novoValor.value = '';
  novoDesde.value = props.hoje;
  dialogo.value = true;
}
const pronto = computed(() => centavosDe(novoValor.value) !== null && !!novoDesde.value);
const gravarVersao = (motivo: string) =>
  versaoFaixa({
    faixa: alvo.value!.id,
    versao: alvo.value!.versao,
    valor: centavosDe(novoValor.value)!,
    desde: novoDesde.value!,
    motivo,
  });
</script>

<template>
  <section class="bloco" data-testid="cargo-faixas">
    <p v-if="ficha.faixas.length === 0" class="secundario" data-testid="faixas-vazio">
      {{ t('pessoas.cargos.faixas.vazio') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-faixas">
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.cargos.faixas.faixa') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.nivel') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.valor') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.desde') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.ate') }}</th>
          <th scope="col">{{ t('pessoas.cargos.colunas.situacao') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.motivo') }}</th>
          <th v-if="pode" scope="col">{{ t('pessoas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in ficha.faixas" :key="x.id" :data-testid="`faixa-${x.id}`">
          <th scope="row">{{ x.faixa }}</th>
          <td>{{ x.nivel }}</td>
          <td>{{ reais(x.valor) }}</td>
          <td>{{ dataBr(x.desde) }}</td>
          <td>{{ dataBr(x.ate) }}</td>
          <td>
            {{
              !x.ativo
                ? t('pessoas.cargos.inativo')
                : x.vigente
                  ? t('pessoas.cargos.vigente')
                  : t('pessoas.cargos.encerrada')
            }}
          </td>
          <td>{{ x.motivoSituacao ?? x.motivo ?? '' }}</td>
          <td v-if="pode">
            <div class="acoes">
              <SanteBotao
                v-if="x.vigente"
                :rotulo="t('pessoas.cargos.faixas.novoValor')"
                variante="texto"
                :data-testid="`versao-faixa-${x.id}`"
                @acionar="pedirVersao(x.id, x.versao)"
              />
              <SanteBotao
                v-if="x.ate === null"
                :rotulo="x.ativo ? t('pessoas.cargos.inativar') : t('pessoas.cargos.reativar')"
                variante="texto"
                :data-testid="`situacao-faixa-${x.id}`"
                @acionar="emit('situacao', { alvo: 'faixa', id: x.id, versao: x.versao, ativo: !x.ativo })"
              />
              <SanteBotao
                :rotulo="t('pessoas.cargos.excluir')"
                variante="texto"
                :data-testid="`excluir-faixa-${x.id}`"
                @acionar="emit('excluir', { alvo: 'faixa', id: x.id, versao: x.versao })"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <form
      v-if="pode && ficha.cargo.ativo"
      class="bloco"
      aria-labelledby="pes-faixa-incluir"
      data-testid="form-faixa"
      @submit.prevent="incluir"
    >
      <h3 id="pes-faixa-incluir">{{ t('pessoas.cargos.faixas.incluirTitulo') }}</h3>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
      <ErroPessoas v-if="erro" :erro="erro" />
      <div class="campos">
        <SanteCampoTexto
          v-model="faixa"
          :rotulo="t('pessoas.cargos.faixas.faixa')"
          :max-bytes="10"
          obrigatorio
          data-testid="faixa-faixa"
        />
        <SanteCampoTexto
          v-model="nivel"
          :rotulo="t('pessoas.cargos.faixas.nivel')"
          :max-bytes="10"
          obrigatorio
          data-testid="faixa-nivel"
        />
        <SanteCampoTexto
          v-model="valor"
          :rotulo="t('pessoas.cargos.faixas.valor')"
          :max-bytes="16"
          obrigatorio
          data-testid="faixa-valor"
        />
        <SanteData
          v-model="desde"
          :rotulo="t('pessoas.cargos.faixas.desde')"
          editavel
          data-testid="faixa-desde"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('pessoas.cargos.faixas.incluir')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="incluir-faixa"
        />
      </div>
    </form>

    <DialogoMotivo
      v-model:visivel="dialogo"
      :titulo="t('pessoas.cargos.faixas.versaoTitulo')"
      :texto="t('pessoas.cargos.faixas.versaoTexto')"
      :confirmar="t('pessoas.cargos.faixas.novoValor')"
      variante="primario"
      :pronto="pronto"
      :acao="gravarVersao"
      testid="dialogo-versao-faixa"
      @feito="(r) => emit('gravado', r)"
    >
      <div class="campos">
        <SanteCampoTexto
          v-model="novoValor"
          :rotulo="t('pessoas.cargos.faixas.valor')"
          :max-bytes="16"
          data-testid="versao-faixa-valor"
        />
        <SanteData
          v-model="novoDesde"
          :rotulo="t('pessoas.cargos.faixas.desde')"
          editavel
          data-testid="versao-faixa-desde"
        />
      </div>
    </DialogoMotivo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
