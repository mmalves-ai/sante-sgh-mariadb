<script setup lang="ts">
// O laudo de internação SUS da AIH aberta (F7, 06-SUS linha 57): os laudos (inicial e especiais) com número, situação,
// impressão e lote; a devolução pelo gestor (AIH solicitada), o reenvio corrigido (AIH devolvida, com os dados atuais já
// preenchidos e a conferência na hora) e o laudo especial (AIH autorizada: OPM, sangue e diárias).
import type { AihLida } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  devolverLaudo,
  emitirLaudoEspecial,
  lerLaudosDaAih,
  marcarLaudoImpresso,
  reenviarLaudo,
  TIPOS_ITEM_LAUDO_ESPECIAL,
  type TipoItemLaudoEspecial,
} from '../api-laudo-internacao-sus.js';

const props = defineProps<{ aih: AihLida; podeRegistrar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const p = (k: string, a?: Record<string, unknown>) => t(`faturamentoSus.aih.laudoSus.${k}`, a ?? {});

// A versão da AIH chega como texto de 10 dígitos (contrato da AIH); as rotas do laudo comparam o número.
const versaoAih = () => Number(props.aih.versao);

const laudos = useQuery({
  queryKey: computed(() => ['sus', 'laudos-internacao', 'aih', props.aih.id, props.aih.versao]),
  queryFn: () => lerLaudosDaAih(props.aih.id),
});

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function executar(fn: () => Promise<void>, feito: string): Promise<boolean> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = feito;
    await cliente.invalidateQueries({ queryKey: ['sus'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    ocupado.value = false;
  }
}

// Impressão: marca a primeira impressão e abre a impressão do navegador.
async function imprimir(laudo: number): Promise<void> {
  if (await executar(() => marcarLaudoImpresso(laudo), p('impresso'))) window.print();
}

// Devolução pelo gestor (AIH solicitada).
const motivo = ref('');
async function devolver(): Promise<void> {
  if (await executar(() => devolverLaudo(props.aih.id, versaoAih(), motivo.value.trim()), p('devolvido')))
    motivo.value = '';
}

// Reenvio corrigido (AIH devolvida): os dados atuais preenchidos; precisa mudar algo.
const correcao = reactive({ justificativa: '', procedimento: '', cid: '' });
watch(
  () => [props.aih.id, props.aih.versao],
  () => {
    correcao.justificativa = props.aih.justificativa;
    correcao.procedimento = props.aih.procedimentoSolicitado;
    correcao.cid = props.aih.cidPrincipal;
  },
  { immediate: true },
);
const cidNormal = (v: string) => v.trim().replace('.', '').toUpperCase();
const problemaReenvio = computed<string | null>(() => {
  if (correcao.justificativa.trim().length < 10) return p('justificativaCurta');
  if (!/^\d{10}$/.test(correcao.procedimento.trim())) return p('procedimentoInvalido');
  if (!/^[A-Z]\d{2}[0-9A-Z]{0,2}$/.test(cidNormal(correcao.cid))) return p('cidInvalido');
  const mudou =
    correcao.justificativa.trim() !== props.aih.justificativa.trim() ||
    correcao.procedimento.trim() !== props.aih.procedimentoSolicitado ||
    cidNormal(correcao.cid) !== props.aih.cidPrincipal;
  return mudou ? null : p('semCorrecao');
});
function reenviar(): Promise<boolean> {
  return executar(
    () =>
      reenviarLaudo(props.aih.id, {
        versao: versaoAih(),
        justificativa: correcao.justificativa.trim(),
        procedimentoSolicitado:
          correcao.procedimento.trim() !== props.aih.procedimentoSolicitado
            ? correcao.procedimento.trim()
            : null,
        cidPrincipal: cidNormal(correcao.cid) !== props.aih.cidPrincipal ? cidNormal(correcao.cid) : null,
      }),
    p('reenviado'),
  );
}

// Laudo especial (AIH autorizada).
const especial = reactive<{
  justificativa: string;
  itens: { tipo: TipoItemLaudoEspecial; procedimento: string; quantidade: string }[];
}>({ justificativa: '', itens: [{ tipo: 'opm', procedimento: '', quantidade: '1' }] });
const opcoesTipo = computed(() =>
  TIPOS_ITEM_LAUDO_ESPECIAL.map((x) => ({ valor: x, rotulo: p(`tipos.${x}`) })),
);
function problemaItem(x: {
  tipo: TipoItemLaudoEspecial;
  procedimento: string;
  quantidade: string;
}): string | null {
  const q = Number(x.quantidade.replace(',', '.'));
  if (!/^\d{10}$/.test(x.procedimento.trim())) return p('procedimentoInvalido');
  if (x.tipo === 'opm' && !x.procedimento.trim().startsWith('07')) return p('opmGrupo07');
  if (!(q > 0)) return p('quantidadeInvalida');
  if ((x.tipo === 'diaria_uti' || x.tipo === 'diaria_acompanhante') && !Number.isInteger(q))
    return p('diariaInteira');
  return null;
}
const especialValido = computed(
  () =>
    especial.justificativa.trim().length >= 10 &&
    especial.itens.length > 0 &&
    especial.itens.every((x) => problemaItem(x) === null),
);
async function emitirEspecial(): Promise<void> {
  const ok = await executar(
    () =>
      emitirLaudoEspecial(props.aih.id, {
        versao: versaoAih(),
        justificativa: especial.justificativa.trim(),
        itens: especial.itens.map((x) => ({
          tipo: x.tipo,
          procedimento: x.procedimento.trim(),
          quantidade: Number(x.quantidade.replace(',', '.')),
        })),
      }),
    p('especialEmitido'),
  );
  if (ok) {
    especial.justificativa = '';
    especial.itens = [{ tipo: 'opm', procedimento: '', quantidade: '1' }];
  }
}
</script>

<template>
  <section aria-labelledby="laudo-sus-titulo" data-testid="laudo-sus">
    <h3 id="laudo-sus-titulo">{{ p('titulo') }}</h3>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="laudo-sus-mensagem" />
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="laudos.isError.value" :erro="laudos.error.value" />
    <p v-else-if="!laudos.data.value">{{ t('faturamentoSus.carregando') }}</p>
    <p v-else-if="laudos.data.value.length === 0" data-testid="laudo-sus-vazio">{{ p('nenhum') }}</p>
    <table v-else class="tabela" data-testid="laudo-sus-lista">
      <thead>
        <tr>
          <th scope="col">{{ p('numero') }}</th>
          <th scope="col">{{ p('tipo') }}</th>
          <th scope="col">{{ p('situacao') }}</th>
          <th scope="col">{{ p('lote') }}</th>
          <th scope="col">{{ p('itensEspeciais') }}</th>
          <th scope="col">
            <span class="sr-only">{{ p('acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in laudos.data.value" :key="l.id" :data-testid="`laudo-sus-linha-${l.tipo}`">
          <td>{{ l.numero }}</td>
          <td>{{ p(`tiposLaudo.${l.tipo}`) }}</td>
          <td data-testid="laudo-sus-situacao">
            {{ p(`situacoes.${l.situacao}`) }}
            <small v-if="l.motivoDevolucao && l.situacao === 'devolvido'">{{
              `— ${l.motivoDevolucao}`
            }}</small>
          </td>
          <td>{{ l.lote?.numero ?? '—' }}</td>
          <td>
            <span v-for="x in l.especiais" :key="x.sequencia" class="item-especial">
              {{ p(`tipos.${x.tipo}`) }} {{ x.procedimento }}{{ ' × ' }}{{ x.quantidade }}
            </span>
            <span v-if="l.especiais.length === 0">{{ '—' }}</span>
          </td>
          <td>
            <SanteBotao
              v-if="podeRegistrar && l.situacao !== 'cancelado'"
              :rotulo="l.impressoEm ? p('reimprimir') : p('imprimir')"
              variante="secundario"
              :desabilitado="ocupado"
              :data-testid="`laudo-sus-imprimir-${l.id}`"
              @acionar="imprimir(l.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="podeRegistrar">
      <form
        v-if="aih.situacao === 'solicitada'"
        class="linha"
        data-testid="laudo-sus-devolucao"
        @submit.prevent="devolver"
      >
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="p('motivoDevolucao')"
          :max-bytes="500"
          data-testid="laudo-sus-motivo"
        />
        <SanteBotao
          :rotulo="p('devolver')"
          tipo="submit"
          variante="secundario"
          :desabilitado="ocupado || motivo.trim().length < 10"
          data-testid="botao-devolver-laudo"
        />
      </form>

      <form v-if="aih.situacao === 'devolvida'" data-testid="laudo-sus-reenvio" @submit.prevent="reenviar">
        <SanteAlerta
          :texto="p('devolvidaAviso', { motivo: aih.justificativaSituacao ?? '' })"
          variante="aviso"
        />
        <div class="linha">
          <SanteCampoTexto
            v-model="correcao.procedimento"
            :rotulo="p('procedimento')"
            :max-bytes="10"
            data-testid="laudo-sus-reenvio-procedimento"
          />
          <SanteCampoTexto
            v-model="correcao.cid"
            :rotulo="p('cid')"
            :max-bytes="6"
            data-testid="laudo-sus-reenvio-cid"
          />
        </div>
        <SanteCampoTexto
          v-model="correcao.justificativa"
          :rotulo="p('justificativa')"
          :max-bytes="2000"
          data-testid="laudo-sus-reenvio-justificativa"
        />
        <p v-if="problemaReenvio" class="aviso-campo" data-testid="laudo-sus-reenvio-problema">
          {{ problemaReenvio }}
        </p>
        <SanteBotao
          :rotulo="p('reenviar')"
          tipo="submit"
          :desabilitado="ocupado || problemaReenvio !== null"
          data-testid="botao-reenviar-laudo"
        />
      </form>

      <form
        v-if="aih.situacao === 'autorizada'"
        data-testid="laudo-sus-especial"
        @submit.prevent="emitirEspecial"
      >
        <h4>{{ p('especialTitulo') }}</h4>
        <div
          v-for="(x, i) in especial.itens"
          :key="i"
          class="linha"
          :data-testid="`laudo-sus-especial-item-${i}`"
        >
          <SanteSelecao
            v-model="x.tipo"
            :rotulo="p('tipo')"
            :opcoes="opcoesTipo"
            :data-testid="`laudo-sus-especial-tipo-${i}`"
          />
          <SanteCampoTexto
            v-model="x.procedimento"
            :rotulo="p('procedimento')"
            :max-bytes="10"
            :data-testid="`laudo-sus-especial-procedimento-${i}`"
          />
          <SanteCampoTexto
            v-model="x.quantidade"
            :rotulo="p('quantidade')"
            :max-bytes="7"
            :data-testid="`laudo-sus-especial-quantidade-${i}`"
          />
          <span v-if="problemaItem(x)" class="aviso-campo">{{ problemaItem(x) }}</span>
          <SanteBotao
            v-if="especial.itens.length > 1"
            :rotulo="p('retirarItem')"
            variante="secundario"
            @acionar="especial.itens.splice(i, 1)"
          />
        </div>
        <SanteBotao
          v-if="especial.itens.length < 20"
          :rotulo="p('incluirItem')"
          variante="secundario"
          data-testid="laudo-sus-especial-incluir"
          @acionar="especial.itens.push({ tipo: 'diaria_uti', procedimento: '', quantidade: '1' })"
        />
        <SanteCampoTexto
          v-model="especial.justificativa"
          :rotulo="p('justificativa')"
          :max-bytes="800"
          data-testid="laudo-sus-especial-justificativa"
        />
        <SanteBotao
          :rotulo="p('emitirEspecial')"
          tipo="submit"
          :desabilitado="ocupado || !especialValido"
          data-testid="botao-emitir-laudo-especial"
        />
      </form>
    </template>
  </section>
</template>

<style scoped>
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.item-especial {
  display: block;
}
.aviso-campo {
  font-weight: 600;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
