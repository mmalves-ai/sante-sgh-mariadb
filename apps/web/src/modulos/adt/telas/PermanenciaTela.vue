<script setup lang="ts">
// Quadro de permanência e reunião de leitos (ficha do M44, seção 7, etapa 2): `/internacao/nir/permanencia`. Três
// colunas (verde, amarelo, vermelho) com o motivo da cor (a alta prevista ou o limite, em dias da Portaria 312), a pauta
// da reunião de leitos (solicitações abertas, altas previstas para hoje e amanhã, barreiras e os indicadores com o
// numerador e o denominador) e a calibragem dos limites (as réguas lado a lado; aplicar a proposta ou definir à mão).
import { ESCOPOS_LIMITE_PERMANENCIA } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';
import {
  CANAL_NIR,
  definirLimite,
  removerLimite,
  lerCalibragem,
  lerGravacaoNir,
  lerPermanencia,
  novaChaveNir,
} from '../api-nir.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import DialogoAlteracaoNir from '../componentes/DialogoAlteracaoNir.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { dataCurta } from '../regras-nir.js';
import { leitoTexto } from '../regras-tela.js';

const { t } = useI18n();
const gravacao = useQuery({ queryKey: ['nir', 'gravacao'], queryFn: lerGravacaoNir, staleTime: 30_000 });
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const avisos = usarAvisosAtendimento(CANAL_NIR, () => void quadro.refetch());
const quadro = useQuery({
  queryKey: ['nir', 'permanencia'],
  queryFn: lerPermanencia,
  refetchInterval: computed(() => avisos.intervalo()),
});
const escopo = ref<string>('clinica');
const calibragem = useQuery({
  queryKey: computed(() => ['nir', 'calibragem', escopo.value]),
  queryFn: () => lerCalibragem(escopo.value),
});
const escopos = computed(() =>
  ESCOPOS_LIMITE_PERMANENCIA.map((e) => ({ valor: e, rotulo: t(`nir.permanencia.escopos.${e}`) })),
);
const cores = ['verde', 'amarelo', 'vermelho'] as const;
const chaveManual = ref('');
const amarelo = ref('');
const vermelho = ref('');
const motivoLimite = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function limite(corpo: Record<string, unknown>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const motivo = motivoLimite.value.trim();
    const r = await definirLimite(
      { escopo: escopo.value, ...corpo, ...(motivo ? { motivo } : {}) },
      novaChaveNir('limite'),
    );
    mensagem.value = r.mensagem;
    motivoLimite.value = '';
    await Promise.all([calibragem.refetch(), quadro.refetch()]);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const regua = (r: { n: number; p50: number | null; p75: number | null; p90: number | null }) =>
  `${r.n} · ${r.p50 ?? '—'} · ${r.p75 ?? '—'} · ${r.p90 ?? '—'}`;
const imprimir = () => globalThis.print?.();

// ── W0-07: remover o limite próprio (volta ao padrão), com o motivo ──
const dRemover = ref(false);
const refRemover = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const chaveRemover = ref('');
function abrirRemover(chave: string): void {
  chaveRemover.value = chave;
  dRemover.value = true;
}
function remover(d: { motivo: string }): void {
  void refRemover.value?.executar(async () => {
    const r = await removerLimite(
      { escopo: escopo.value, chave: chaveRemover.value, motivo: d.motivo },
      novaChaveNir('remover-limite'),
    );
    mensagem.value = r.mensagem;
    await Promise.all([calibragem.refetch(), quadro.refetch()]);
  });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nir-perm-titulo" data-testid="tela-permanencia">
    <h1 id="nir-perm-titulo">{{ t('nir.permanencia.titulo') }}</h1>
    <p>{{ t('nir.permanencia.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/altas-previstas">{{ t('nir.atalhos.altas') }}</RouterLink>
      <RouterLink to="/internacao/nir/fila">{{ t('nir.atalhos.fila') }}</RouterLink>
    </p>
    <AvisoAdt :motivo="aviso" />
    <ErroAdt v-if="quadro.isError.value" :erro="quadro.error.value" />
    <p v-else-if="!quadro.data.value" role="status">{{ t('nir.carregando') }}</p>
    <template v-else>
      <div class="kanban">
        <section
          v-for="c in cores"
          :key="c"
          class="painel coluna"
          :class="`coluna-${c}`"
          :aria-labelledby="`col-${c}`"
          :data-testid="`coluna-${c}`"
        >
          <h2 :id="`col-${c}`">
            {{ t(`nir.permanencia.cores.${c}`) }} ({{ quadro.data.value.colunas[c].length }})
          </h2>
          <ul class="lista-simples">
            <li
              v-for="i in quadro.data.value.colunas[c]"
              :key="i.internacao"
              :data-testid="`perm-${i.internacao}`"
            >
              <strong>{{ i.nome }}</strong>
              <span class="secundario">
                · {{ t('nir.permanencia.cartao', { leito: leitoTexto(i.leito), dias: i.dias312 }) }}</span
              >
              <br />
              <span class="secundario">{{ i.motivoCor }}</span>
              <span v-if="i.dpa" class="secundario">
                · {{ t('nir.altas.dpa', { data: dataCurta(i.dpa.data) }) }}</span
              >
              <span v-if="i.limite" class="secundario">
                ·
                {{
                  t('nir.permanencia.limite', {
                    amarelo: i.limite.amareloDias,
                    vermelho: i.limite.vermelhoDias,
                    origem: t(`nir.permanencia.origens.${i.limite.origem}`),
                  })
                }}</span
              >
              <span v-if="i.barreiras.some((b) => b.situacao === 'aberta')" class="secundario">
                · {{ t('nir.altas.barreiras') }}:
                {{ i.barreiras.filter((b) => b.situacao === 'aberta').length }}</span
              >
            </li>
          </ul>
        </section>
      </div>
      <section class="painel" aria-labelledby="nir-reuniao" data-testid="reuniao-leitos">
        <h2 id="nir-reuniao">{{ t('nir.permanencia.reuniao') }}</h2>
        <p class="secundario">{{ t('nir.permanencia.reuniaoTexto') }}</p>
        <p data-testid="reuniao-resumo">
          {{
            t('nir.permanencia.resumo', {
              solicitacoes: quadro.data.value.reuniao.solicitacoesAbertas,
              reservas: quadro.data.value.reuniao.reservasVigentes,
              hoje: quadro.data.value.reuniao.altasHoje.length,
              amanha: quadro.data.value.reuniao.altasAmanha.length,
              semDpa: quadro.data.value.reuniao.semDpa,
              barreiras: quadro.data.value.reuniao.barreirasAbertas,
              vencidas: quadro.data.value.reuniao.barreirasVencidas,
            })
          }}
        </p>
        <table class="tabela" data-testid="indicadores-nir">
          <caption>
            {{
              t('nir.permanencia.indicadores')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('nir.permanencia.indicador') }}</th>
              <th scope="col">{{ t('nir.permanencia.numerador') }}</th>
              <th scope="col">{{ t('nir.permanencia.denominador') }}</th>
              <th scope="col">{{ t('nir.permanencia.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in quadro.data.value.reuniao.indicadores" :key="x.codigo">
              <th scope="row">{{ x.nome }}</th>
              <td>{{ x.numerador }}</td>
              <td>{{ x.denominador }}</td>
              <td>{{ x.valor === null ? '—' : `${x.valor} ${x.unidade}` }}</td>
            </tr>
          </tbody>
        </table>
        <SanteBotao variante="secundario" :rotulo="t('nir.permanencia.imprimir')" @acionar="imprimir" />
      </section>
    </template>
    <section class="painel" aria-labelledby="nir-calibragem" data-testid="calibragem">
      <h2 id="nir-calibragem">{{ t('nir.permanencia.calibragem') }}</h2>
      <p class="secundario">{{ t('nir.permanencia.calibragemTexto') }}</p>
      <SanteSelecao
        v-model="escopo"
        :rotulo="t('nir.permanencia.escopo')"
        :opcoes="escopos"
        data-testid="calib-escopo"
      />
      <ErroAdt v-if="calibragem.isError.value" :erro="calibragem.error.value" />
      <p v-else-if="!calibragem.data.value" role="status">{{ t('nir.carregando') }}</p>
      <table v-else class="tabela" data-testid="calib-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('nir.permanencia.chave') }}</th>
            <th scope="col">{{ t('nir.permanencia.regua312') }}</th>
            <th scope="col">{{ t('nir.permanencia.reguaFaturavel') }}</th>
            <th scope="col">{{ t('nir.permanencia.reguaUti') }}</th>
            <th scope="col">{{ t('nir.permanencia.proposta') }}</th>
            <th scope="col">{{ t('nir.permanencia.vigente') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in calibragem.data.value.linhas" :key="l.chave" :data-testid="`calib-${l.chave}`">
            <th scope="row">{{ l.chave }} · {{ l.nome }}</th>
            <td>{{ regua(l.portaria312) }}</td>
            <td>{{ l.diariasFaturaveis.p50 ?? '—' }} · {{ l.diariasFaturaveis.p90 ?? '—' }}</td>
            <td>{{ l.uti.p50 ?? '—' }} · {{ l.uti.p90 ?? '—' }}</td>
            <td>
              <template v-if="l.proposta">
                {{ l.proposta.amareloDias }}/{{ l.proposta.vermelhoDias }}
                <SanteBotao
                  v-if="pode('limite')"
                  variante="secundario"
                  :rotulo="t('nir.permanencia.aplicarProposta')"
                  :desabilitado="ocupado"
                  :data-testid="`aplicar-${l.chave}`"
                  @acionar="
                    limite({
                      chave: l.chave,
                      amareloDias: l.proposta.amareloDias,
                      vermelhoDias: l.proposta.vermelhoDias,
                      origem: 'calibrado',
                      amostra: l.portaria312.n,
                    })
                  "
                />
              </template>
              <template v-else>{{ t('nir.permanencia.semProposta') }}</template>
            </td>
            <td>
              {{
                l.vigente ? `${l.vigente.amareloDias}/${l.vigente.vermelhoDias} (${l.vigente.origem})` : '—'
              }}
              <SanteBotao
                v-if="l.vigente && pode('removerLimite')"
                variante="texto"
                :rotulo="t('crudNir.removerLimite')"
                :data-testid="`remover-limite-${l.chave}`"
                @acionar="abrirRemover(l.chave)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <details v-if="pode('limite')">
        <summary>{{ t('nir.permanencia.limiteManual') }}</summary>
        <SanteCampoTexto v-model="chaveManual" :rotulo="t('nir.permanencia.chave')" :max-bytes="20" />
        <SanteCampoTexto v-model="amarelo" :rotulo="t('nir.permanencia.amarelo')" :max-bytes="3" />
        <SanteCampoTexto v-model="vermelho" :rotulo="t('nir.permanencia.vermelho')" :max-bytes="3" />
        <SanteBotao
          :rotulo="t('nir.permanencia.gravarLimite')"
          :desabilitado="ocupado || !chaveManual.trim() || !/^\d+$/.test(amarelo) || !/^\d+$/.test(vermelho)"
          @acionar="
            limite({
              chave: chaveManual.trim(),
              amareloDias: Number(amarelo),
              vermelhoDias: Number(vermelho),
              origem: 'manual',
            })
          "
        />
      </details>
      <SanteCampoTexto
        v-if="pode('limite')"
        v-model="motivoLimite"
        :rotulo="t('crudNir.motivoAlteracao')"
        :max-bytes="300"
        data-testid="limite-motivo"
      />
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <ErroAdt v-if="erro" :erro="erro" />
      <DialogoAlteracaoNir
        ref="refRemover"
        v-model:visivel="dRemover"
        :titulo="t('crudNir.removerLimiteTitulo', { chave: chaveRemover })"
        :texto="t('crudNir.removerLimiteTexto')"
        :rotulo-confirmar="t('crudNir.removerLimite')"
        destrutivo
        testid="dialogo-remover-limite"
        @confirmar="remover"
      />
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.kanban {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-3);
}
.coluna {
  border-top: 6px solid var(--sgh-borda);
}
.coluna-verde {
  border-top-color: var(--sgh-sucesso);
}
.coluna-amarelo {
  border-top-color: var(--sgh-aviso);
}
.coluna-vermelho {
  border-top-color: var(--sgh-alerta);
}
@media print {
  .acoes,
  [data-testid='calibragem'] {
    display: none;
  }
}
/* Alvo de toque de ao menos 24 px (WCAG 2.2, 2.5.8). */
summary {
  min-height: 2rem;
  padding-block: var(--sgh-espaco-1);
  cursor: pointer;
}
</style>
