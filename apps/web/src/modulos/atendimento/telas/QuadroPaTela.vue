<script setup lang="ts">
// Quadro do PA (ficha do M20, seção 7): `/pa/quadro`. Os atendimentos de pronto atendimento abertos, por etapa
// (aguardando, em atendimento médico, em exames, reavaliação, observação, decisão), na ordem de prioridade legal e
// de chegada, com o tempo na etapa e o total; o tempo-alvo da porta ao médico; a observação perto ou além do
// limite de 24 h em destaque; registrar a etapa e abrir o desfecho. M44: com a classificação de risco, cada cartão
// ganha a cor com o nome escrito, o prazo ("faltam N min" ou "passou N min") e o aviso "Reclassificar agora"; a
// coluna fica na ordem do risco (decidida no servidor) e o cabeçalho mostra a contagem por cor. O canal de eventos
// avisa cada mudança (as gravações do novo e o vigia de 1 a 2 s das senhas) e o quadro relê; sem o canal, a cada 15 s.
// O paciente que saiu pela outra ponta sem o desfecho codificado (liberado do local, ou com a alta no cabeçalho)
// aparece à parte, nunca como aguardando. W0-07 (M1): o chip do alerta de deterioração (NEWS2, qSOFA e SIRS, calculados
// no servidor) e, no limiar de sepse da instituição, o atalho para abrir o protocolo de sepse; o diálogo dos escores
// registra a aferição e estorna o escore errado com o motivo.
import '../../recepcao/componentes/estilo-classificacao.css';
import { type CartaoPa, ETAPAS_PA_MANUAIS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CANAL_QUADRO, lerQuadroPa, novaChave, registrarEtapaPa } from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import EscoresPaDialogo from '../componentes/EscoresPaDialogo.vue';
import MarcaRisco from '../../recepcao/componentes/MarcaRisco.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { usarAtendimento } from '../usar-atendimento.js';
import { usarAvisosAtendimento } from '../vigia.js';
// M52.3: o atalho para quem está de plantão agora (médicos, enfermagem e sobreaviso).
import LinkPlantaoAgora from '../../pessoas/componentes/LinkPlantaoAgora.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const { gravacao, motivoPa } = usarAtendimento();
const avisos = usarAvisosAtendimento(CANAL_QUADRO, () => void quadro.refetch());
const quadro = useQuery({
  queryKey: ['atendimento', 'quadro'],
  queryFn: () => lerQuadroPa(),
  refetchInterval: computed(() => avisos.intervalo()),
});
const podeEtapa = computed(() => gravacao.data.value?.operacoes['pa:etapa']?.pode ?? false);
const etapas = computed(() => [
  { valor: '', rotulo: t('atendimento.quadro.registrarEtapa') },
  ...ETAPAS_PA_MANUAIS.map((e) => ({ valor: e as string, rotulo: t(`atendimento.etapas.${e}`) })),
]);
const escolhas = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function registrar(reg: number): Promise<void> {
  const etapa = escolhas.value[reg];
  if (!etapa) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarEtapaPa(reg, { etapa }, novaChave('etapa'));
    mensagem.value = r.mensagem;
    escolhas.value[reg] = '';
    await cliente.invalidateQueries({ queryKey: ['atendimento', 'quadro'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const tempo = (m: number) =>
  m >= 60
    ? t('atendimento.horasMinutos', { h: Math.floor(m / 60), m: m % 60 })
    : t('atendimento.minutos', { n: m });
const prioridade = (p: '0' | '1' | '2') => t(`atendimento.fila.prioridades.${p}`);
const podeClassificar = computed(() => pode('recepcao.classificacao.ler'));
const porCor = computed(() => (quadro.data.value?.porCor ?? []).filter((x) => x.total > 0));
// W0-07 (M1): o diálogo dos escores de deterioração (registrar com a etapa do quadro; ler com o quadro).
const escoresDe = ref<{ reg: number; paciente: string } | null>(null);
// O atalho para o protocolo só para quem lê os protocolos do paciente (dado clínico sensível); os outros veem o texto.
const verProtocolos = computed(() => pode('recepcao.protocoloPaciente.ler'));
const escoresVisivel = computed({
  get: () => escoresDe.value !== null,
  set: (v: boolean) => {
    if (!v) escoresDe.value = null;
  },
});
const textoChip = (a: NonNullable<CartaoPa['alertaEscore']>) =>
  `${t(a.news2.completo && a.qsofa.completo ? 'escorePa.chip' : 'escorePa.chipParcial', {
    news2: a.news2.total,
    qsofa: a.qsofa.total,
    sirs: a.sirs.total,
  })} · ${t(`escorePa.niveis.${a.nivel}`)}`;
</script>

<template>
  <section class="tela-agenda quadro-pa" aria-labelledby="quadro-titulo" data-testid="tela-quadro-pa">
    <h1 id="quadro-titulo">{{ t('atendimento.quadro.titulo') }}</h1>
    <LinkPlantaoAgora />
    <p>{{ t('atendimento.quadro.texto') }}</p>
    <AvisoAtendimento :motivo="motivoPa" />
    <p class="acoes">
      <RouterLink to="/pa/observacao">{{ t('atendimento.observacao.titulo') }}</RouterLink>
      <RouterLink to="/recepcao/atendimento/novo">{{ t('atendimento.abrir.titulo') }}</RouterLink>
    </p>
    <ErroAtendimento v-if="quadro.isError.value" :erro="quadro.error.value" />
    <p v-else-if="!quadro.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <p class="secundario">
        {{
          t('atendimento.quadro.resumo', {
            n: quadro.data.value.total,
            alvo: quadro.data.value.alvoPortaMedico,
          })
        }}
      </p>
      <section
        v-if="porCor.length"
        class="painel"
        aria-labelledby="quadro-por-cor"
        data-testid="quadro-por-cor"
      >
        <h2 id="quadro-por-cor">{{ t('classificacao.quadro.porCor') }}</h2>
        <ul class="lista-simples por-cor">
          <li v-for="x in porCor" :key="x.cor" :data-testid="`por-cor-${x.cor}`">
            <MarcaRisco :cor="x.cor === 'semClassificacao' ? null : x.cor" /> {{ x.total }}
            <template v-if="x.estourados > 0">
              · {{ t('classificacao.quadro.estourados', { n: x.estourados }) }}</template
            >
          </li>
        </ul>
      </section>
      <div class="colunas-pa">
        <section
          v-for="c in quadro.data.value.colunas"
          :key="c.codigo"
          class="coluna-pa"
          :aria-labelledby="`coluna-${c.codigo}`"
          :data-testid="`coluna-${c.codigo}`"
        >
          <h2 :id="`coluna-${c.codigo}`">
            {{ c.rotulo }} <span class="secundario">({{ c.cartoes.length }})</span>
          </h2>
          <ul class="cartoes-pa">
            <li
              v-for="k in c.cartoes"
              :key="k.reg"
              class="cartao-pa"
              :class="k.risco ? `risco-faixa-${k.risco.cor}` : ''"
              :data-testid="`cartao-${k.reg}`"
            >
              <p v-if="k.risco" :data-testid="`risco-${k.reg}`">
                <MarcaRisco :cor="k.risco.cor" :nome="k.risco.nomeCor" />
                <span class="secundario">
                  ·
                  {{
                    k.risco.minutosRestantes >= 0
                      ? t('classificacao.quadro.faltam', { min: k.risco.minutosRestantes })
                      : t('classificacao.quadro.passou', { min: -k.risco.minutosRestantes })
                  }}
                  <template v-if="k.risco.reclassificacoes > 0">
                    ·
                    {{
                      t('classificacao.quadro.reclassificacoes', { n: k.risco.reclassificacoes })
                    }}</template
                  >
                </span>
              </p>
              <p v-else-if="k.risco === null && podeClassificar" class="secundario">
                <MarcaRisco :cor="null" /> ·
                <RouterLink :to="`/pa/classificacao/${k.reg}`" :data-testid="`classificar-${k.reg}`">{{
                  t('classificacao.quadro.classificar')
                }}</RouterLink>
              </p>
              <p v-if="k.risco?.reclassificar">
                <RouterLink
                  :to="`/pa/classificacao/${k.reg}/reclassificar`"
                  class="reclassificar-agora"
                  :data-testid="`reclassificar-agora-${k.reg}`"
                  >{{ t('classificacao.quadro.reclassificar') }}</RouterLink
                >
              </p>
              <p
                v-for="pr in k.protocolos ?? []"
                :key="pr.tipo"
                :data-testid="`protocolo-quadro-${k.reg}-${pr.tipo}`"
              >
                <RouterLink to="/pa/protocolos">
                  <SanteAlerta
                    :variante="pr.atrasadas > 0 ? 'alerta' : 'info'"
                    icone="relogio"
                    :texto="
                      pr.proxima && pr.proxima.minutosRestantes >= 0
                        ? t('protocolos.quadro.chip', {
                            tipo: pr.nomeTipo,
                            meta: pr.proxima.titulo,
                            min: pr.proxima.minutosRestantes,
                          })
                        : pr.atrasadas > 0
                          ? t('protocolos.quadro.chipVencida', { tipo: pr.nomeTipo })
                          : t('protocolos.quadro.chipSem', { tipo: pr.nomeTipo })
                    "
                  />
                </RouterLink>
              </p>
              <div v-if="k.alertaEscore" class="chip-escore" :data-testid="`escore-quadro-${k.reg}`">
                <SanteAlerta
                  :variante="
                    k.alertaEscore.sugereSepse || k.alertaEscore.nivel === 'alto'
                      ? 'alerta'
                      : k.alertaEscore.nivel === 'medio' || k.alertaEscore.nivel === 'baixoMedio'
                        ? 'aviso'
                        : 'info'
                  "
                  :icone="k.alertaEscore.sugereSepse ? 'alerta' : 'relogio'"
                  :texto="textoChip(k.alertaEscore)"
                />
                <p v-if="k.alertaEscore.origem === 'sinais'" class="secundario">
                  {{ t('escorePa.daClassificacao') }}
                </p>
                <p v-if="k.alertaEscore.sugereSepse">
                  <RouterLink
                    v-if="verProtocolos"
                    :to="`/pa/protocolos?reg=${k.reg}&tipo=sepse`"
                    class="sugestao-sepse"
                    :data-testid="`escore-sepse-${k.reg}`"
                    >{{ t('escorePa.sugereSepse') }}</RouterLink
                  >
                  <strong v-else class="sugestao-sepse" :data-testid="`escore-sepse-${k.reg}`">{{
                    t('escorePa.sugereSepse')
                  }}</strong>
                </p>
              </div>
              <p>
                <strong>{{ k.paciente }}</strong>
                <span v-if="k.idade !== null" class="secundario">
                  · {{ t('atendimento.anos', { n: k.idade }) }}</span
                >
              </p>
              <p class="secundario">
                {{ k.senha ?? t('atendimento.semSenha') }} · {{ prioridade(k.prioridade) }}
                <template v-if="k.leito"> · {{ k.leito }}</template>
              </p>
              <p>
                {{ t('atendimento.quadro.naEtapa', { tempo: tempo(k.minutosNaEtapa) }) }} ·
                {{ t('atendimento.quadro.total', { tempo: tempo(k.minutosTotal) }) }}
              </p>
              <SanteAlerta
                v-if="k.alertaObservacao"
                variante="alerta"
                :texto="t('atendimento.quadro.alertaObservacao')"
              />
              <p v-if="k.semMarcas" class="secundario">{{ t('atendimento.quadro.semMarcas') }}</p>
              <div class="acoes">
                <template v-if="podeEtapa">
                  <SanteSelecao
                    :model-value="escolhas[k.reg] ?? ''"
                    :rotulo="t('atendimento.quadro.etapaDe', { paciente: k.paciente })"
                    ocultar-rotulo
                    :opcoes="etapas"
                    :data-testid="`etapa-${k.reg}`"
                    @update:model-value="(v: string) => (escolhas[k.reg] = v)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('atendimento.quadro.registrar')"
                    :desabilitado="!escolhas[k.reg] || ocupado"
                    :data-testid="`registrar-etapa-${k.reg}`"
                    @acionar="registrar(k.reg)"
                  />
                </template>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('escorePa.abrirEscores')"
                  :aria-label="t('escorePa.abrirEscoresDe', { paciente: k.paciente })"
                  :data-testid="`escores-${k.reg}`"
                  @acionar="escoresDe = { reg: k.reg, paciente: k.paciente }"
                />
                <RouterLink :to="`/pa/desfecho/${k.reg}`" :data-testid="`desfecho-${k.reg}`">{{
                  t('atendimento.desfecho.titulo')
                }}</RouterLink>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </template>
    <section
      v-if="quadro.data.value?.saidasSemDesfecho.length"
      class="painel"
      aria-labelledby="quadro-saidas"
      data-testid="quadro-saidas"
    >
      <h2 id="quadro-saidas">{{ t('atendimento.quadro.saidas') }}</h2>
      <p class="secundario">{{ t('atendimento.quadro.saidasTexto') }}</p>
      <ul class="lista-simples">
        <li v-for="x in quadro.data.value.saidasSemDesfecho" :key="x.reg" :data-testid="`saida-${x.reg}`">
          <strong>{{ x.paciente }}</strong>
          · {{ x.senha ?? t('atendimento.semSenha') }} · {{ t(`atendimento.quadro.sinais.${x.sinal}`) }}
          <template v-if="x.leito"> · {{ x.leito }}</template>
          ·
          <RouterLink :to="`/pa/desfecho/${x.reg}`">{{ t('atendimento.quadro.codificar') }}</RouterLink>
        </li>
      </ul>
    </section>
    <p v-if="mensagem" role="status" data-testid="quadro-mensagem">{{ mensagem }}</p>
    <ErroAtendimento v-if="erro" :erro="erro" />
    <EscoresPaDialogo
      v-if="escoresDe"
      v-model:visivel="escoresVisivel"
      :reg="escoresDe.reg"
      :paciente="escoresDe.paciente"
      :pode-registrar="podeEtapa"
    />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.quadro-pa {
  max-width: none;
}
.colunas-pa {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.coluna-pa {
  border: 1px solid var(--sgh-borda);
  border-radius: 8px;
  padding: var(--sgh-espaco-2);
  background: var(--sgh-fundo-elevado);
}
.coluna-pa h2 {
  font-size: 1rem;
  margin: 0 0 var(--sgh-espaco-2);
}
.cartoes-pa {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.cartao-pa {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
}
.cartao-pa p {
  margin: 0 0 var(--sgh-espaco-1);
}
.por-cor {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
}
.reclassificar-agora {
  font-weight: 700;
}
.chip-escore {
  display: grid;
  gap: var(--sgh-espaco-1);
  margin: 0 0 var(--sgh-espaco-1);
}
.sugestao-sepse {
  font-weight: 700;
}
</style>
