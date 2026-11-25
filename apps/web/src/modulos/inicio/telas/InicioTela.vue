<script setup lang="ts">
// Página inicial por perfil (ficha do M27, seção 7 e regra 1; cap-03 §3.2 e §3.5): `/inicio`. A tela inicial é a fila
// do perfil: os cartões dos componentes que o servidor liberou (módulo entregue, permissão do módulo de origem e a
// funcionalidade ligada no estabelecimento; recolher o módulo esconde o cartão), ordenados por prioridade e prazo, cada
// um com o resumo da fila e os primeiros itens. Quem acumula perfis (médico e recepção) escolhe o perfil ativo: a fila
// do outro sai da página inicial e continua no menu. Sem nenhum componente liberado, as telas que o perfil já abre.
import { ARVORE_MENU, type ComponenteInicio } from '@sgh/contratos';
import { SanteOpcoes } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  barreirasAbertas,
  componentesDoPerfil,
  guardarPerfil,
  lerPerfilGuardado,
  montarCartoes,
  perfilAtivo,
  type ResumoDaFila,
  resumoAssinaturas,
  resumoAgravos,
  resumoCcih,
  resumoMedico,
  resumoMensagens,
  resumoNir,
  resumoNutricao,
  resumoPa,
  resumoQualidade,
  resumoRecepcao,
} from '../../../casca/inicio/inicio.js';
import { lerQuadroPa } from '../../atendimento/api-atendimento.js';
import { lerAltasPrevistas, lerFilaNir } from '../../adt/api-nir.js';
import { lerFilaNutricao } from '../../nutricao/api-nutricao.js';
import { lerResumoPrazos } from '../../qualidade/api.js';
import { lerResumoCcih } from '../../qualidade/ccih/api-ccih.js';
import { lerResumoAgravos } from '../../qualidade/vigilancia/api-agravo.js';
import { dataCurta } from '../../adt/regras-nir.js';
import { itensVisiveis } from '../../../casca/menu/filtro-menu.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { horaDe } from '../../recepcao/formato.js';
import { lerPendencias } from '../../pep/api-documentos.js';
import {
  donoDaSessao,
  lerCaixa,
  lerPaginaInicio,
  lerWorklistMedico,
  lerWorklistRecepcao,
} from '../api-inicio.js';
import ErroTrabalho from '../componentes/ErroTrabalho.vue';
import MarcaRisco from '../../recepcao/componentes/MarcaRisco.vue';

const { t } = useI18n();
const { estabelecimentoAtivo, permissoes, sessao } = usarSessao();
const dono = computed(() => donoDaSessao(sessao.value));
const pagina = useQuery({
  queryKey: computed(() => ['inicio', 'pagina', dono.value]),
  queryFn: () => lerPaginaInicio(),
});
const escolhido = ref<ComponenteInicio | null>(null);
watch(
  () => pagina.data.value,
  (p) => {
    if (p && escolhido.value === null) escolhido.value = perfilAtivo(p, lerPerfilGuardado());
  },
  { immediate: true },
);
watch(escolhido, (v) => v && guardarPerfil(v));
/** O perfil no grupo de opções (sempre um valor; o grupo só aparece com dois perfis ou mais). */
const perfilDaTela = computed<ComponenteInicio>({
  get: () => escolhido.value ?? pagina.data.value?.perfis[0]?.id ?? 'medico',
  set: (v) => (escolhido.value = v),
});
const perfis = computed(() =>
  (pagina.data.value?.perfis ?? []).map((p) => ({ valor: p.id, rotulo: p.titulo })),
);
const visiveis = computed(() =>
  pagina.data.value ? componentesDoPerfil(pagina.data.value, escolhido.value) : [],
);
const tem = (id: ComponenteInicio) => computed(() => visiveis.value.some((c) => c.id === id));

// Os resumos de cada fila (só as visíveis; a recepção relê a cada 30 s, a do médico a cada minuto).
const medico = useQuery({
  queryKey: computed(() => ['inicio', 'medico', dono.value]),
  queryFn: () => lerWorklistMedico(),
  enabled: tem('medico'),
  refetchInterval: 60_000,
});
const recepcao = useQuery({
  queryKey: computed(() => ['inicio', 'recepcao', null, dono.value]),
  queryFn: () => lerWorklistRecepcao(null),
  enabled: tem('recepcao'),
  refetchInterval: 30_000,
});
const mensagens = useQuery({
  queryKey: computed(() => ['mensagens', 'caixa', dono.value]),
  queryFn: () => lerCaixa(),
  enabled: tem('mensagens'),
  refetchInterval: 60_000,
});
const assinaturas = useQuery({
  queryKey: computed(() => ['inicio', 'assinaturas', dono.value]),
  queryFn: () => lerPendencias(),
  enabled: tem('assinaturas'),
  refetchInterval: 120_000,
});

// M44 (etapa 3): os cartões do PA (quadro por cor) e do NIR (solicitações a cada 30 s; barreiras a cada minuto).
const pa = useQuery({
  queryKey: computed(() => ['inicio', 'pa', dono.value]),
  queryFn: () => lerQuadroPa(),
  enabled: tem('pa'),
  refetchInterval: 30_000,
});
const nir = useQuery({
  queryKey: computed(() => ['inicio', 'nir', dono.value]),
  queryFn: () => lerFilaNir(),
  enabled: tem('nir'),
  refetchInterval: 30_000,
});
// As barreiras de alta abertas (a fonte de /internacao/nir/altas-previstas), só para quem pode ver as altas previstas.
const podeBarreiras = computed(() => tem('nir').value && permissoes.value.has('internacao.altaPrevista.ler'));
const altas = useQuery({
  queryKey: computed(() => ['inicio', 'nir-barreiras', dono.value]),
  queryFn: () => lerAltasPrevistas(),
  enabled: podeBarreiras,
  refetchInterval: 60_000,
});
const barreiras = computed(() => (altas.data.value ? barreirasAbertas(altas.data.value) : []));
// M45 (etapa 5): o cartão da nutrição (a fila de pacientes a triar a cada minuto).
const nutricao = useQuery({
  queryKey: computed(() => ['inicio', 'nutricao', dono.value]),
  queryFn: () => lerFilaNutricao(null),
  enabled: tem('nutricao'),
  refetchInterval: 60_000,
});
const topoNutricao = computed(() =>
  (nutricao.data.value?.itens ?? []).filter((i) => i.situacao !== 'triado').slice(0, 5),
);

// M48 (etapa 1): o cartão do NSP (as notificações por prazo regulatório, a cada 2 minutos).
const qualidade = useQuery({
  queryKey: computed(() => ['inicio', 'qualidade', dono.value]),
  queryFn: () => lerResumoPrazos(),
  enabled: tem('qualidade'),
  refetchInterval: 120_000,
});

// M48 (etapa 3): o cartão da CCIH (os pacientes em vigilância, a cada 2 minutos; só contagens).
const ccih = useQuery({
  queryKey: computed(() => ['inicio', 'ccih', dono.value]),
  queryFn: () => lerResumoCcih(),
  enabled: tem('ccih'),
  refetchInterval: 120_000,
});

// M48 (etapa 4): o cartão da notificação compulsória (casos aguardando e sugestões, a cada 2 minutos; só contagens).
const agravos = useQuery({
  queryKey: computed(() => ['inicio', 'agravos', dono.value]),
  queryFn: () => lerResumoAgravos(),
  enabled: tem('agravos'),
  refetchInterval: 120_000,
});

const cartoes = computed(() => {
  const resumos: Partial<Record<ComponenteInicio, ResumoDaFila>> = {};
  if (medico.data.value) resumos.medico = resumoMedico(medico.data.value);
  if (recepcao.data.value) resumos.recepcao = resumoRecepcao(recepcao.data.value);
  if (mensagens.data.value) resumos.mensagens = resumoMensagens(mensagens.data.value);
  if (assinaturas.data.value) resumos.assinaturas = resumoAssinaturas(assinaturas.data.value.total);
  if (pa.data.value) resumos.pa = resumoPa(pa.data.value);
  if (nir.data.value) resumos.nir = resumoNir(nir.data.value, barreiras.value);
  if (nutricao.data.value) resumos.nutricao = resumoNutricao(nutricao.data.value);
  if (qualidade.data.value) resumos.qualidade = resumoQualidade(qualidade.data.value);
  if (ccih.data.value) resumos.ccih = resumoCcih(ccih.data.value);
  if (agravos.data.value) resumos.agravos = resumoAgravos(agravos.data.value);
  return montarCartoes(visiveis.value, resumos);
});
const topoMedico = computed(() => (medico.data.value?.pacientes ?? []).slice(0, 5));
const topoRecepcao = computed(() => (recepcao.data.value?.senhas ?? []).slice(0, 5));
const topoPa = computed(() =>
  (pa.data.value?.colunas.flatMap((c) => c.cartoes) ?? [])
    .filter((k) => k.risco)
    .sort(
      (a, b) =>
        a.risco!.prioridade - b.risco!.prioridade || a.risco!.minutosRestantes - b.risco!.minutosRestantes,
    )
    .slice(0, 5),
);
const topoNir = computed(() => (nir.data.value?.itens ?? []).slice(0, 5));
const topoBarreiras = computed(() => barreiras.value.slice(0, 3));
const topoMensagens = computed(() =>
  (mensagens.data.value?.recebidas ?? []).filter((m) => m.lidaEm === null).slice(0, 5),
);
const disponiveis = computed(() =>
  itensVisiveis(ARVORE_MENU, permissoes.value).filter((i) => i.rota !== '/inicio'),
);
const prazoTexto = (p: string) => `${p.slice(8, 10)}/${p.slice(5, 7)} ${p.slice(11, 16)}`;
</script>

<template>
  <section class="tela tela-agenda" aria-labelledby="inicio-titulo" data-testid="tela-inicio">
    <h1 id="inicio-titulo">{{ t('inicio.titulo') }}</h1>
    <p v-if="estabelecimentoAtivo" data-testid="inicio-estabelecimento">
      {{ t('inicio.estabelecimento', { nome: estabelecimentoAtivo.nome }) }}
    </p>
    <ErroTrabalho v-if="pagina.isError.value" :erro="pagina.error.value" />
    <p v-else-if="!pagina.data.value" role="status">{{ t('trabalho.carregando') }}</p>
    <template v-else>
      <div v-if="perfis.length > 1" class="painel" data-testid="inicio-perfil">
        <p class="secundario">{{ t('trabalho.inicio.perfilTexto') }}</p>
        <SanteOpcoes
          v-model="perfilDaTela"
          :legenda="t('trabalho.inicio.perfil')"
          :opcoes="perfis"
          nome="perfil-ativo"
        />
      </div>
      <template v-if="cartoes.length > 0">
        <h2 class="sgh-visualmente-oculto">{{ t('trabalho.inicio.filas') }}</h2>
        <div class="filas" data-testid="inicio-cartoes">
          <article
            v-for="c in cartoes"
            :key="c.id"
            class="painel cartao"
            :class="{ urgente: c.prioridade >= 80 }"
            :data-testid="`cartao-${c.id}`"
            :aria-labelledby="`cartao-titulo-${c.id}`"
          >
            <header class="cartao__topo">
              <h3 :id="`cartao-titulo-${c.id}`">
                <RouterLink :to="c.rota" :aria-label="t('trabalho.inicio.abrirFila', { titulo: c.titulo })">{{
                  c.titulo
                }}</RouterLink>
              </h3>
              <span v-if="c.pendentes === null" class="secundario">{{
                t('trabalho.inicio.carregandoFila')
              }}</span>
              <strong v-else-if="c.pendentes > 0" class="selo" :data-testid="`selo-${c.id}`">{{
                t('trabalho.inicio.pendentes', { n: c.pendentes })
              }}</strong>
              <span v-else class="secundario" :data-testid="`selo-${c.id}`">{{
                t('trabalho.inicio.semPendencia')
              }}</span>
            </header>
            <p v-if="c.prazo" class="secundario">
              {{ t('trabalho.inicio.prazo', { quando: prazoTexto(c.prazo) }) }}
            </p>
            <ul v-if="c.id === 'medico' && topoMedico.length > 0" class="lista" data-testid="topo-medico">
              <li v-for="p in topoMedico" :key="p.atendimento">
                <RouterLink :to="`/pep/paciente/${p.paciente}`">{{ p.nome }}</RouterLink>
                <span class="secundario"> · {{ p.leito ?? t('trabalho.medico.semLeito') }}</span>
                <span v-for="x in p.pendencias.slice(0, 3)" :key="x.tipo" class="chip">{{
                  t(`trabalho.medico.tipos.${x.tipo}`)
                }}</span>
              </li>
            </ul>
            <ul
              v-if="c.id === 'recepcao' && topoRecepcao.length > 0"
              class="lista"
              data-testid="topo-recepcao"
            >
              <li v-for="s in topoRecepcao" :key="s.id">
                <strong>{{ s.senha }}</strong>
                <span class="secundario">
                  · {{ t(`trabalho.recepcao.prioridades.${s.prioridade}`) }} ·
                  {{ t('trabalho.recepcao.esperaMin', { n: s.esperaMinutos }) }}</span
                >
              </li>
            </ul>
            <ul v-if="c.id === 'pa' && topoPa.length > 0" class="lista" data-testid="topo-pa">
              <li v-for="k in topoPa" :key="k.reg">
                <MarcaRisco :cor="k.risco!.cor" :nome="k.risco!.nomeCor" />
                <span> {{ k.senha ?? k.paciente }}</span>
                <span class="secundario">
                  ·
                  {{
                    k.risco!.minutosRestantes >= 0
                      ? t('classificacao.quadro.faltam', { min: k.risco!.minutosRestantes })
                      : t('classificacao.quadro.passou', { min: -k.risco!.minutosRestantes })
                  }}</span
                >
                <span v-for="p in k.protocolos ?? []" :key="p.tipo" class="chip">{{ p.nomeTipo }}</span>
              </li>
            </ul>
            <ul v-if="c.id === 'nir' && topoNir.length > 0" class="lista" data-testid="topo-nir">
              <li v-for="x in topoNir" :key="x.id">
                <RouterLink to="/internacao/nir/fila">{{ x.paciente.nome }}</RouterLink>
                <span class="secundario">
                  · {{ t(`nir.prioridades.${x.prioridade}`) }} · {{ t(`nir.estados.${x.estado}`) }}</span
                >
                <span v-if="x.prazoEstourado" class="chip">{{ t('nir.fila.prazoVencido') }}</span>
              </li>
            </ul>
            <p v-if="c.id === 'nir' && nir.data.value" class="secundario" data-testid="resumo-nir">
              {{
                t('regulacao.cartao.solicitacoes', {
                  n: nir.data.value.itens.length,
                  estourados: nir.data.value.estourados,
                })
              }}
              <template v-if="nir.data.value.conflitos.length > 0">
                · {{ t('regulacao.cartao.conflitos', { n: nir.data.value.conflitos.length }) }}</template
              >
              <template v-if="altas.data.value">
                ·
                {{
                  t('regulacao.cartao.barreiras', {
                    n: barreiras.length,
                    vencidas: barreiras.filter((b) => b.vencida).length,
                  })
                }}</template
              >
            </p>
            <ul
              v-if="c.id === 'nir' && topoBarreiras.length > 0"
              class="lista"
              data-testid="topo-nir-barreiras"
            >
              <li v-for="b in topoBarreiras" :key="b.id">
                <RouterLink to="/internacao/nir/altas-previstas">{{ b.nome }}</RouterLink>
                <span class="secundario">
                  · {{ b.leito }} · {{ t(`nir.altas.tipos.${b.tipo}`) }} ·
                  {{ t('regulacao.cartao.prazoBarreira', { prazo: dataCurta(b.prazo) }) }}</span
                >
                <span v-if="b.vencida" class="chip">{{ t('nir.altas.vencida') }}</span>
              </li>
            </ul>
            <p
              v-if="c.id === 'qualidade' && qualidade.data.value"
              class="secundario"
              data-testid="resumo-qualidade"
            >
              {{
                t('qualidade.prazos.resumoCartao', {
                  vencido: qualidade.data.value.porSituacao.vencido,
                  breve: qualidade.data.value.porSituacao.venceEmBreve,
                  prazo: qualidade.data.value.porSituacao.noPrazo,
                })
              }}
            </p>
            <p v-if="c.id === 'ccih' && ccih.data.value" class="secundario" data-testid="resumo-ccih">
              {{
                t('ccih.cartao.resumo', {
                  emVigilancia: ccih.data.value.emVigilancia,
                  semLiberacao: ccih.data.value.semLiberacao,
                })
              }}
            </p>
            <p
              v-if="c.id === 'agravos' && agravos.data.value"
              class="secundario"
              data-testid="resumo-agravos"
            >
              {{
                t('agravos.cartao.resumo', {
                  abertos: agravos.data.value.abertos,
                  vencidos: agravos.data.value.vencidos,
                  gatilhos: agravos.data.value.gatilhosSemCaso,
                })
              }}
            </p>
            <p
              v-if="c.id === 'nutricao' && nutricao.data.value"
              class="secundario"
              data-testid="resumo-nutricao"
            >
              {{
                t('nutricao.fila.resumo', {
                  vencida: nutricao.data.value.contagens.vencida,
                  atencao: nutricao.data.value.contagens.atencao,
                  atriar: nutricao.data.value.contagens['a-triar'],
                  reavaliar: nutricao.data.value.contagens.reavaliar,
                  triado: nutricao.data.value.contagens.triado,
                })
              }}
            </p>
            <ul
              v-if="c.id === 'nutricao' && topoNutricao.length > 0"
              class="lista"
              data-testid="topo-nutricao"
            >
              <li v-for="i in topoNutricao" :key="i.internacao">
                <RouterLink to="/nutricao/triagem">{{ i.nome }}</RouterLink>
                <span class="secundario">
                  · {{ i.leito.bloco }} {{ i.leito.acomodacao }} {{ i.leito.leito }} ·
                  {{
                    t(`nutricao.situacoes.${i.situacao}`, {
                      h:
                        i.situacao === 'vencida'
                          ? nutricao.data.value?.prazoHoras
                          : nutricao.data.value?.preferencialHoras,
                    })
                  }}</span
                >
              </li>
            </ul>
            <p v-if="c.id === 'nutricao'" class="secundario">
              <RouterLink to="/nutricao/mapa">{{ t('nutricao.atalhos.mapa') }}</RouterLink>
            </p>
            <ul
              v-if="c.id === 'mensagens' && topoMensagens.length > 0"
              class="lista"
              data-testid="topo-mensagens"
            >
              <li v-for="m in topoMensagens" :key="m.id">
                <RouterLink :to="`/mensagens?abrir=${m.id}`">{{ m.assunto }}</RouterLink>
                <span class="secundario"> · {{ m.remetente }} · {{ horaDe(m.enviadaEm) }}</span>
              </li>
            </ul>
          </article>
        </div>
      </template>
      <div v-else class="vazio" data-testid="fila-vazia">
        <h2>{{ t('inicio.vazio') }}</h2>
        <p>{{ t('trabalho.inicio.nenhumComponente') }}</p>
        <template v-if="disponiveis.length > 0">
          <p>{{ t('inicio.disponiveis') }}</p>
          <ul data-testid="inicio-disponiveis">
            <li v-for="i in disponiveis" :key="i.id">
              <RouterLink :to="i.rota!">{{ i.titulo }}</RouterLink>
            </li>
          </ul>
        </template>
        <p v-else data-testid="inicio-nada-disponivel">{{ t('inicio.nadaDisponivel') }}</p>
      </div>
      <p class="secundario">{{ t('inicio.dicaAtalhos') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.filas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  gap: var(--sgh-espaco-3);
}
.cartao__topo {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
}
.cartao__topo h3 {
  margin: 0;
  font-size: 1.05rem;
}
.cartao__topo a,
.lista a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.cartao.urgente {
  border-color: var(--sgh-alerta);
  border-width: 2px;
}
.selo {
  font-weight: 700;
}
.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.chip {
  display: inline-block;
  margin-left: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  font-size: var(--sgh-fonte-pequena);
}
.vazio {
  border: 1px dashed var(--sgh-borda-forte);
  border-radius: 8px;
  padding: var(--sgh-espaco-4);
  color: var(--sgh-texto);
  background: var(--sgh-fundo-sutil);
}
.vazio h2 {
  margin-top: 0;
}
.vazio li a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
</style>
