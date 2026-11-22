<script setup lang="ts">
// Procedimentos extras (ficha do M20, seção 7): `/recepcao/atendimento/:reg/procedimentos`. A situação da conta antes
// (regra 2: fechada, apresentada, emitida ou sem conta, o lançamento não entraria nela; o aviso e o botão
// desabilitado), os extras já lançados e o lançamento novo pela tabela do convênio. W1-05: cada extra se corrige
// (quantidade e data, com justificativa) e se estorna (justificativa e a senha de novo, em diálogo) enquanto a conta
// estiver aberta; com a conta fechada, apresentada ou emitida, o servidor recusa e a tela encaminha ao faturamento.
import type { ProcedimentoExtraLido } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { avisoContaSemLancamento } from '@sgh/dominio-atendimento';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarProcedimentosAtendimento,
  corrigirProcedimentoExtra,
  estornarProcedimentoExtra,
  lancarProcedimento,
  lerAtendimento,
  novaChave,
} from '../api-atendimento.js';
import { calcularPrecoAtendimento } from '../../agenda/api-estruturada.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import OrigemPrecoAviso from '../componentes/OrigemPrecoAviso.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { hojeIso } from '../regras-tela.js';
import { usarAtendimento } from '../usar-atendimento.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivoAmbulatorio } = usarAtendimento();
const reg = computed(() => Number(props.reg));
const ficha = useQuery({
  queryKey: computed(() => ['atendimento', 'ficha', reg.value]),
  queryFn: () => lerAtendimento(reg.value),
});
const aviso = computed(() =>
  ficha.data.value ? avisoContaSemLancamento(ficha.data.value.conta.situacao) : null,
);
const termo = ref('');
const achados = ref<{ codigo: number; nome: string }[]>([]);
const escolhido = ref<{ codigo: number; nome: string } | null>(null);
const quantidade = ref(1);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const chave = ref(novaChave('extra'));
const podeLancar = computed(() => pode('atendimento.lancarProcedimentoExtra').value && aviso.value === null);
// ADR 0009: antes de lançar, o preço (com a origem) e o credenciamento do profissional no convênio do atendimento.
const preco = useQuery({
  queryKey: computed(() => ['atendimento', 'preco', reg.value, escolhido.value?.codigo ?? 0]),
  queryFn: () => calcularPrecoAtendimento(reg.value, escolhido.value?.codigo ?? 0),
  enabled: computed(() => escolhido.value !== null),
});
const bloqueado = computed(() => preco.data.value?.credenciamento?.efeito === 'bloqueio');
async function procurar(): Promise<void> {
  erro.value = null;
  try {
    achados.value = await buscarProcedimentosAtendimento(
      ficha.data.value?.convenio.codigo ?? 0,
      termo.value.trim(),
    );
  } catch (e) {
    erro.value = e;
  }
}
async function lancar(): Promise<void> {
  if (!escolhido.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await lancarProcedimento(
      reg.value,
      { procedimento: escolhido.value.codigo, quantidade: quantidade.value },
      chave.value,
    );
    mensagem.value = r.mensagem;
    escolhido.value = null;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    chave.value = novaChave('extra');
    ocupado.value = false;
  }
}

// ── Correção e estorno do extra (W1-05) ──
const podeCorrigir = computed(
  () =>
    (pode('atendimento.corrigirProcedimentoExtra').value ||
      pode('atendimento.estornarProcedimentoExtra').value) &&
    !ficha.data.value?.desfecho,
);
const alvo = ref<ProcedimentoExtraLido | null>(null);
const modo = ref<'corrigir' | 'estornar' | null>(null);
const novaQuantidade = ref(1);
const novaData = ref('');
const justificativa = ref('');
const senha = ref('');
const erroAcao = ref<unknown>(null);
const hoje = hojeIso();
const dataMinima = computed(() => {
  const d = ficha.data.value?.data ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
});
const dialogoAberto = computed({
  get: () => modo.value !== null,
  set: (v: boolean) => {
    if (!v) fecharDialogo();
  },
});
function abrirDialogo(x: ProcedimentoExtraLido, m: 'corrigir' | 'estornar'): void {
  alvo.value = x;
  modo.value = m;
  novaQuantidade.value = x.quantidade;
  novaData.value = '';
  justificativa.value = '';
  senha.value = '';
  erroAcao.value = null;
}
function fecharDialogo(): void {
  modo.value = null;
  alvo.value = null;
  senha.value = '';
}
const correcaoMuda = computed(
  () => alvo.value !== null && (novaQuantidade.value !== alvo.value.quantidade || novaData.value !== ''),
);
const prontoAcao = computed(
  () =>
    justificativa.value.trim().length >= 10 &&
    !ocupado.value &&
    (modo.value === 'estornar' ? senha.value !== '' : correcaoMuda.value && novaQuantidade.value >= 1),
);
async function confirmarAcao(): Promise<void> {
  const x = alvo.value;
  if (!x || !prontoAcao.value) return;
  erroAcao.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r =
      modo.value === 'estornar'
        ? await estornarProcedimentoExtra(
            reg.value,
            x.seq,
            { justificativa: justificativa.value.trim(), senha: senha.value },
            novaChave('estorno'),
          )
        : await corrigirProcedimentoExtra(
            reg.value,
            x.seq,
            {
              justificativa: justificativa.value.trim(),
              ...(novaQuantidade.value !== x.quantidade ? { quantidade: novaQuantidade.value } : {}),
              ...(novaData.value ? { data: novaData.value } : {}),
            },
            novaChave('correcao-extra'),
          );
    mensagem.value = r.mensagem;
    fecharDialogo();
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (e) {
    erroAcao.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
const real = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="extras-titulo" data-testid="tela-procedimentos">
    <h1 id="extras-titulo">{{ t('atendimento.procedimentos.titulo') }}</h1>
    <p>{{ t('atendimento.procedimentos.texto') }}</p>
    <AvisoAtendimento :motivo="motivoAmbulatorio" />
    <ErroAtendimento v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <ResumoAtendimento :atendimento="ficha.data.value" atalhos />
      <section class="painel" aria-labelledby="extras-conta">
        <h2 id="extras-conta">{{ t('atendimento.procedimentos.conta') }}</h2>
        <p data-testid="situacao-conta">
          {{ ficha.data.value.conta.rotulo }} ·
          {{ t('atendimento.procedimentos.itens', { n: ficha.data.value.conta.itens }) }}
        </p>
        <div v-if="aviso" role="alert" data-testid="aviso-conta">
          <SanteAlerta variante="alerta" :texto="aviso" />
        </div>
      </section>
      <section class="painel" aria-labelledby="extras-lancados">
        <h2 id="extras-lancados">{{ t('atendimento.procedimentos.lancados') }}</h2>
        <p v-if="ficha.data.value.extras.length === 0">{{ t('atendimento.nenhum') }}</p>
        <table v-else class="tabela" data-testid="tabela-extras">
          <caption>
            {{
              t('atendimento.procedimentos.lancadosLegenda', { n: ficha.data.value.extras.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('atendimento.procedimento') }}</th>
              <th scope="col">{{ t('atendimento.procedimentos.quantidade') }}</th>
              <th scope="col">{{ t('atendimento.procedimentos.valor') }}</th>
              <th v-if="podeCorrigir" scope="col">{{ t('atendimento.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in ficha.data.value.extras" :key="x.seq">
              <td>{{ x.procedimento }} · {{ x.nome }}</td>
              <td>{{ x.quantidade }}</td>
              <td>{{ real(x.valor) }}</td>
              <td v-if="podeCorrigir" class="acoes">
                <SanteBotao
                  v-if="pode('atendimento.corrigirProcedimentoExtra').value"
                  variante="secundario"
                  :rotulo="t('atendimento.procedimentos.corrigir')"
                  :aria-label="t('atendimento.procedimentos.corrigirDe', { nome: x.nome })"
                  :data-testid="`extra-corrigir-${x.seq}`"
                  @acionar="abrirDialogo(x, 'corrigir')"
                />
                <SanteBotao
                  v-if="pode('atendimento.estornarProcedimentoExtra').value"
                  variante="secundario"
                  :rotulo="t('atendimento.procedimentos.estornar')"
                  :aria-label="t('atendimento.procedimentos.estornarDe', { nome: x.nome })"
                  :data-testid="`extra-estornar-${x.seq}`"
                  @acionar="abrirDialogo(x, 'estornar')"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="podeCorrigir && ficha.data.value.extras.length" class="secundario">
          {{ t('atendimento.procedimentos.contaFaturamento') }}
        </p>
      </section>
      <section v-if="podeLancar" class="painel" aria-labelledby="extras-novo">
        <h2 id="extras-novo">{{ t('atendimento.procedimentos.novo') }}</h2>
        <form class="filtros" role="search" @submit.prevent="procurar">
          <div class="campo">
            <label for="extras-termo">{{ t('atendimento.abrir.buscarProcedimento') }}</label>
            <input
              id="extras-termo"
              v-model="termo"
              type="search"
              autocomplete="off"
              data-testid="extras-termo"
            />
          </div>
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('atendimento.buscar')"
            data-testid="extras-buscar"
          />
        </form>
        <ul v-if="achados.length && !escolhido">
          <li v-for="p in achados" :key="p.codigo">
            <SanteBotao
              variante="texto"
              :rotulo="`${p.codigo} · ${p.nome}`"
              :data-testid="`extras-proc-${p.codigo}`"
              @acionar="escolhido = p"
            />
          </li>
        </ul>
        <div v-if="escolhido" class="filtros">
          <p>{{ escolhido.codigo }} · {{ escolhido.nome }}</p>
          <div class="campo">
            <label for="extras-qtd">{{ t('atendimento.procedimentos.quantidade') }}</label>
            <input id="extras-qtd" v-model.number="quantidade" type="number" min="1" max="999" />
          </div>
          <p v-if="preco.isFetching.value" role="status">{{ t('estruturada.lancamento.calculando') }}</p>
          <OrigemPrecoAviso v-else-if="preco.data.value" :resultado="preco.data.value" />
          <SanteBotao
            :rotulo="t('atendimento.procedimentos.lancar')"
            :desabilitado="ocupado || quantidade < 1 || bloqueado"
            data-testid="botao-lancar-extra"
            @acionar="lancar"
          />
        </div>
      </section>
      <p v-if="mensagem" role="status" data-testid="extra-lancado">{{ mensagem }}</p>
      <ErroAtendimento v-if="erro" :erro="erro" />
      <SanteDialogo
        v-model:visivel="dialogoAberto"
        :titulo="
          modo === 'estornar'
            ? t('atendimento.procedimentos.estornarTitulo')
            : t('atendimento.procedimentos.corrigirTitulo')
        "
      >
        <form v-if="alvo" class="filtros" data-testid="dialogo-extra" @submit.prevent="confirmarAcao">
          <p>{{ alvo.procedimento }} · {{ alvo.nome }} · {{ alvo.quantidade }} · {{ real(alvo.valor) }}</p>
          <p>
            {{
              modo === 'estornar'
                ? t('atendimento.procedimentos.estornarTexto')
                : t('atendimento.procedimentos.corrigirTexto')
            }}
          </p>
          <template v-if="modo === 'corrigir'">
            <div class="campo">
              <label for="extra-nova-qtd">{{ t('atendimento.procedimentos.quantidade') }}</label>
              <input
                id="extra-nova-qtd"
                v-model.number="novaQuantidade"
                type="number"
                min="1"
                max="999"
                data-testid="extra-nova-quantidade"
              />
            </div>
            <div class="campo">
              <label for="extra-nova-data">{{ t('atendimento.procedimentos.data') }}</label>
              <input
                id="extra-nova-data"
                v-model="novaData"
                type="date"
                :min="dataMinima"
                :max="hoje"
                data-testid="extra-nova-data"
              />
            </div>
          </template>
          <SanteCampoTexto
            v-model="justificativa"
            :rotulo="t('atendimento.procedimentos.justificativa')"
            :max-bytes="200"
            obrigatorio
            id="extra-justificativa"
          />
          <div v-if="modo === 'estornar'" class="campo">
            <label for="extra-senha">{{ t('atendimento.procedimentos.senha') }}</label>
            <input
              id="extra-senha"
              v-model="senha"
              type="password"
              autocomplete="current-password"
              data-testid="extra-senha"
            />
          </div>
          <SanteBotao
            tipo="submit"
            :rotulo="
              modo === 'estornar'
                ? t('atendimento.procedimentos.confirmarEstorno')
                : t('atendimento.procedimentos.gravarCorrecao')
            "
            :desabilitado="!prontoAcao"
            data-testid="botao-confirmar-extra"
          />
          <ErroAtendimento v-if="erroAcao" :erro="erroAcao" />
        </form>
      </SanteDialogo>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
