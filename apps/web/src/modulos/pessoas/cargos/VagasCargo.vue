<script setup lang="ts">
// Aba "Quadro de vagas" da ficha do cargo (W0-06, parte 4b): as vagas aprovadas por centro de custo em todas as
// versões (com a ocupação da vigente), a inclusão no quadro (centro de custo pelo combo com busca), a nova quantidade
// a partir de uma data (versão nova) e a inativação, a reativação e a exclusão do lançado por engano (pela tela-mãe).
import type { AlvoCargos, ApoioCargos, FichaCargo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { incluirVaga, versaoVaga } from './api-cargos.js';
import { quantidadeDe } from './cargos-comum.js';

type Alvo = { alvo: AlvoCargos; id: number; versao: number };
const props = defineProps<{ ficha: FichaCargo; apoio: ApoioCargos; pode: boolean }>();
const emit = defineEmits<{
  gravado: [r: unknown];
  situacao: [x: Alvo & { ativo: boolean }];
  excluir: [x: Alvo];
}>();
const { t } = useI18n();

const opcoesCentro = computed(() =>
  props.apoio.centrosCusto.map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
const centro = ref<number | null>(null);
const quantidade = ref('');
const desde = ref<string | null>(props.apoio.hoje);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function incluir(): Promise<void> {
  erro.value = null;
  const q = quantidadeDe(quantidade.value);
  aviso.value = q === null ? t('pessoas.cargos.vagas.quantidadeInvalida') : null;
  if (q === null || centro.value === null || !desde.value) return;
  ocupado.value = true;
  try {
    const r = await incluirVaga({
      cargo: props.ficha.cargo.id,
      centroCusto: centro.value,
      quantidade: q,
      desde: desde.value,
    });
    centro.value = null;
    quantidade.value = '';
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const dialogo = ref(false);
const alvo = ref<{ id: number; versao: number } | null>(null);
const novaQuantidade = ref('');
const novoDesde = ref<string | null>(null);
function pedirVersao(id: number, versao: number): void {
  alvo.value = { id, versao };
  novaQuantidade.value = '';
  novoDesde.value = props.apoio.hoje;
  dialogo.value = true;
}
const pronto = computed(() => quantidadeDe(novaQuantidade.value) !== null && !!novoDesde.value);
const gravarVersao = (motivo: string) =>
  versaoVaga({
    vaga: alvo.value!.id,
    versao: alvo.value!.versao,
    quantidade: quantidadeDe(novaQuantidade.value)!,
    desde: novoDesde.value!,
    motivo,
  });
</script>

<template>
  <section class="bloco" data-testid="cargo-vagas">
    <p v-if="ficha.vagas.length === 0" class="secundario" data-testid="vagas-vazio">
      {{ t('pessoas.cargos.vagas.vazio') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-vagas">
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.cargos.vagas.centroCusto') }}</th>
          <th scope="col">{{ t('pessoas.cargos.vagas.quantidade') }}</th>
          <th scope="col">{{ t('pessoas.cargos.vagas.ocupadas') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.desde') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.ate') }}</th>
          <th scope="col">{{ t('pessoas.cargos.colunas.situacao') }}</th>
          <th scope="col">{{ t('pessoas.cargos.faixas.motivo') }}</th>
          <th v-if="pode" scope="col">{{ t('pessoas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in ficha.vagas" :key="x.id" :data-testid="`vaga-${x.id}`">
          <th scope="row">{{ x.centroCustoNome }}</th>
          <td>{{ x.quantidade }}</td>
          <td>{{ x.ocupadas }}</td>
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
                :rotulo="t('pessoas.cargos.vagas.novaQuantidade')"
                variante="texto"
                :data-testid="`versao-vaga-${x.id}`"
                @acionar="pedirVersao(x.id, x.versao)"
              />
              <SanteBotao
                v-if="x.ate === null"
                :rotulo="x.ativo ? t('pessoas.cargos.inativar') : t('pessoas.cargos.reativar')"
                variante="texto"
                :data-testid="`situacao-vaga-${x.id}`"
                @acionar="emit('situacao', { alvo: 'vaga', id: x.id, versao: x.versao, ativo: !x.ativo })"
              />
              <SanteBotao
                :rotulo="t('pessoas.cargos.excluir')"
                variante="texto"
                :data-testid="`excluir-vaga-${x.id}`"
                @acionar="emit('excluir', { alvo: 'vaga', id: x.id, versao: x.versao })"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <form
      v-if="pode && ficha.cargo.ativo"
      class="bloco"
      aria-labelledby="pes-vaga-incluir"
      data-testid="form-vaga"
      @submit.prevent="incluir"
    >
      <h3 id="pes-vaga-incluir">{{ t('pessoas.cargos.vagas.incluirTitulo') }}</h3>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
      <ErroPessoas v-if="erro" :erro="erro" />
      <div class="campos">
        <SanteSelecao
          v-model="centro"
          :rotulo="t('pessoas.cargos.vagas.centroCusto')"
          :opcoes="opcoesCentro"
          busca
          obrigatorio
          data-testid="vaga-centro"
        />
        <SanteCampoTexto
          v-model="quantidade"
          :rotulo="t('pessoas.cargos.vagas.quantidade')"
          :max-bytes="4"
          obrigatorio
          data-testid="vaga-quantidade"
        />
        <SanteData
          v-model="desde"
          :rotulo="t('pessoas.cargos.faixas.desde')"
          editavel
          data-testid="vaga-desde"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('pessoas.cargos.vagas.incluir')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="incluir-vaga"
        />
      </div>
    </form>

    <DialogoMotivo
      v-model:visivel="dialogo"
      :titulo="t('pessoas.cargos.vagas.versaoTitulo')"
      :texto="t('pessoas.cargos.vagas.versaoTexto')"
      :confirmar="t('pessoas.cargos.vagas.novaQuantidade')"
      variante="primario"
      :pronto="pronto"
      :acao="gravarVersao"
      testid="dialogo-versao-vaga"
      @feito="(r) => emit('gravado', r)"
    >
      <div class="campos">
        <SanteCampoTexto
          v-model="novaQuantidade"
          :rotulo="t('pessoas.cargos.vagas.quantidade')"
          :max-bytes="4"
          data-testid="versao-vaga-quantidade"
        />
        <SanteData
          v-model="novoDesde"
          :rotulo="t('pessoas.cargos.faixas.desde')"
          editavel
          data-testid="versao-vaga-desde"
        />
      </div>
    </DialogoMotivo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
