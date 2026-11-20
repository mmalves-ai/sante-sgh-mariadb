<script setup lang="ts">
// Mapa de dietas e etiqueta de bandeja (ficha do M45, seção 7; regras 11 e 12): `/nutricao/mapa`. Por unidade, refeição e
// dia: a dieta da última prescrição válida até o corte, o jejum prescrito ou agendado (bloco e exames) prevalecendo, as
// características, a alergia alimentar e o acompanhante; a mudança depois do corte alerta a copa. A copa fecha o retrato
// no corte (o hash do que está na tela) e gera as etiquetas de bandeja em ZPL; a refeição do acompanhante só com direito
// legal.
// W0-05: a refeição do acompanhante vigente se altera (a dieta, as refeições e o fim, sem encerrar o direito) pelo diálogo
// de correção, com o motivo obrigatório; o valor anterior fica no histórico, mostrado no diálogo do acompanhante.
import {
  type AlteracaoHotLida,
  BASES_LEGAIS_ACOMPANHANTE,
  type BaseLegalAcompanhante,
  type EtiquetasGeradas,
  type LinhaMapa,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import DialogoCorrecao from '../componentes/DialogoCorrecao.vue';
import {
  alterarAcompanhante,
  encerrarAcompanhante,
  fecharMapa,
  gerarEtiquetas,
  lerAcompanhantes,
  lerGravacaoMapa,
  lerMapa,
  lerOpcoesMapa,
  novaChaveNutricao,
  registrarAcompanhante,
} from '../api-nutricao.js';
import AvisoNutricao from '../componentes/AvisoNutricao.vue';
import ErroNutricao from '../componentes/ErroNutricao.vue';
import { combinaBusca, dataLonga, instanteCurto, leitoTexto, urlDoTexto } from '../regras-nutricao.js';

const { t } = useI18n();
// O item do menu "Etiqueta de bandeja e dieta do acompanhante" abre esta tela com ?aba=etiquetas: o título e o texto
// dessa função, as etiquetas como ação principal e o foco nelas quando o mapa abre.
const route = useRoute();
const modoEtiquetas = computed(() => route.query['aba'] === 'etiquetas');
const gravacao = useQuery({
  queryKey: ['nutricao', 'mapa-gravacao'],
  queryFn: lerGravacaoMapa,
  staleTime: 30_000,
});
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const unidade = ref<string>('');
// Os cortes são os da unidade escolhida (regra 11: corte por unidade).
const opcoes = useQuery({
  queryKey: computed(() => ['nutricao', 'mapa-opcoes', unidade.value]),
  queryFn: () => lerOpcoesMapa(unidade.value || undefined),
  staleTime: 60_000,
  placeholderData: (anterior) => anterior,
});
const refeicao = ref<number | null>(null);
const data = ref<string | null>(null);
watch(
  () => opcoes.data.value,
  (o) => {
    if (!o) return;
    if (!unidade.value) unidade.value = o.unidades[0]?.unidade ?? '';
    if (refeicao.value === null) refeicao.value = o.refeicoes[0]?.codigo ?? null;
    if (!data.value) data.value = o.hoje;
  },
  { immediate: true },
);
const unidades = computed(() =>
  (opcoes.data.value?.unidades ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.unidade})` })),
);
const refeicoes = computed(() =>
  (opcoes.data.value?.refeicoes ?? []).map((r) => ({
    valor: r.codigo,
    rotulo: t('nutricao.mapa.refeicaoOpcao', { nome: r.nome, horario: r.horario, corte: r.corte }),
  })),
);
const consulta = ref<{ unidade: string; refeicao: number; data: string } | null>(null);
function abrir(): void {
  if (unidade.value && refeicao.value !== null && data.value)
    consulta.value = { unidade: unidade.value, refeicao: refeicao.value, data: data.value };
}
watch(
  () => [unidade.value, refeicao.value, data.value] as const,
  () => {
    if (consulta.value === null) abrir();
  },
);
const mapa = useQuery({
  queryKey: computed(() => ['nutricao', 'mapa', consulta.value]),
  queryFn: () => {
    const q = consulta.value as { unidade: string; refeicao: number; data: string };
    return lerMapa(q.unidade, q.refeicao, q.data);
  },
  enabled: computed(() => consulta.value !== null),
  refetchInterval: 60_000,
});
const m = computed(() => mapa.data.value ?? null);
const busca = ref('');
const linhas = computed(() =>
  (m.value?.linhas ?? []).filter((l) =>
    combinaBusca(busca.value, [
      l.nome,
      String(l.prontuario),
      String(l.internacao),
      `${l.leito.acomodacao} ${l.leito.leito}`,
      `${l.leito.acomodacao}${l.leito.leito}`,
    ]),
  ),
);
const foraDaJanela = computed(() => (m.value ? m.value.lidoEm > m.value.fechamentoAte : false));
const botaoEtiquetas = ref<HTMLElement | null>(null);
watch(
  () => m.value !== null && modoEtiquetas.value,
  async (focar) => {
    if (!focar) return;
    await nextTick();
    botaoEtiquetas.value?.querySelector('button')?.focus();
  },
);
const contagens = computed(() => {
  const c = m.value?.contagens;
  return c
    ? t('nutricao.mapa.contagens', {
        jejum: c.jejum,
        oral: c.oral,
        livre: c.livre,
        enteral: c.enteral,
        parenteral: c.parenteral,
        sem: c['sem-prescricao'],
        acomp: m.value?.acompanhantes ?? 0,
      })
    : '';
});

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function fazer(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = await fn();
    await mapa.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const fechar = () =>
  fazer(async () => {
    const q = consulta.value as { unidade: string; refeicao: number; data: string };
    await fecharMapa({ ...q, hashVisto: m.value?.hash }, novaChaveNutricao('fechar-mapa'));
    return t('nutricao.mapa.fechadoAgora');
  });

// ── Etiquetas ──
const etiquetas = ref<EtiquetasGeradas | null>(null);
const urlEtiquetas = ref<string | null>(null);
function liberarUrl(): void {
  if (urlEtiquetas.value) URL.revokeObjectURL(urlEtiquetas.value);
  urlEtiquetas.value = null;
}
onBeforeUnmount(liberarUrl);
const gerar = () =>
  fazer(async () => {
    liberarUrl();
    const q = consulta.value as { unidade: string; refeicao: number; data: string };
    const r = await gerarEtiquetas(q, novaChaveNutricao('etiquetas'));
    etiquetas.value = r;
    urlEtiquetas.value = r.conteudo ? urlDoTexto(r.conteudo) : null;
    return [
      t('nutricao.mapa.etiquetasGeradas', { n: r.etiquetas, sem: r.semBandeja, sid: r.semIdentificador }),
      r.fila ? (r.fila.novo ? t('nutricao.mapa.naFila') : t('nutricao.mapa.jaNaFila')) : '',
    ]
      .filter(Boolean)
      .join(' ');
  });

// ── Acompanhante ──
const dialogoAcomp = ref(false);
const linhaAcomp = ref<LinhaMapa | null>(null);
const base = ref<BaseLegalAcompanhante>('idoso');
const refeicoesAcomp = ref<number[]>([]);
const inicio = ref<string | null>(null);
const fim = ref<string | null>(null);
const obsAcomp = ref('');
const motivoEncerrar = ref('');
const acompanhantes = useQuery({
  queryKey: computed(() => ['nutricao', 'acompanhantes', linhaAcomp.value?.internacao]),
  queryFn: () => lerAcompanhantes(linhaAcomp.value?.internacao as number),
  enabled: computed(() => dialogoAcomp.value && linhaAcomp.value !== null),
});
const vigente = computed(() => acompanhantes.data.value?.itens.find((a) => a.situacao === 'ativa') ?? null);
const bases = computed(() =>
  BASES_LEGAIS_ACOMPANHANTE.map((b) => ({
    valor: b.codigo,
    rotulo: `${t(`nutricao.mapa.bases.${b.codigo}`)} — ${b.lei}`,
  })),
);
function abrirAcompanhante(l: LinhaMapa): void {
  linhaAcomp.value = l;
  base.value = 'idoso';
  refeicoesAcomp.value = (opcoes.data.value?.refeicoes ?? []).map((r) => r.codigo);
  inicio.value = consulta.value?.data ?? null;
  fim.value = null;
  obsAcomp.value = '';
  motivoEncerrar.value = '';
  dialogoAcomp.value = true;
}
const gravarAcompanhante = () =>
  fazer(async () => {
    const r = await registrarAcompanhante(
      {
        internacao: linhaAcomp.value?.internacao,
        baseLegal: base.value,
        refeicoes: refeicoesAcomp.value,
        inicio: inicio.value,
        fim: fim.value,
        ...(obsAcomp.value.trim() ? { observacao: obsAcomp.value.trim() } : {}),
      },
      novaChaveNutricao('acompanhante'),
    );
    dialogoAcomp.value = false;
    return r.mensagem;
  });
const encerrar = () =>
  fazer(async () => {
    const r = await encerrarAcompanhante(
      vigente.value?.id as number,
      { motivo: motivoEncerrar.value.trim() },
      novaChaveNutricao('encerrar-acompanhante'),
    );
    dialogoAcomp.value = false;
    return r.mensagem;
  });
// ── W0-05: alterar a refeição do acompanhante, com o histórico ──
const dialogoAlterar = ref(false);
const aRefeicoes = ref<number[]>([]);
const aDieta = ref('');
const aFim = ref<string | null>(null);
function abrirAlterar(): void {
  const v = vigente.value;
  if (!v) return;
  aRefeicoes.value = [...v.refeicoes];
  aDieta.value = v.dieta ?? '';
  aFim.value = v.fim;
  dialogoAcomp.value = false;
  dialogoAlterar.value = true;
}
const alvoAlterar = ref<number | null>(null);
watch(vigente, (v) => {
  if (v) alvoAlterar.value = v.id;
});
const gravarAlteracao = ({ motivo }: { motivo: string }) =>
  alterarAcompanhante(
    alvoAlterar.value as number,
    {
      ...(aDieta.value.trim() ? { dieta: aDieta.value.trim() } : {}),
      refeicoes: aRefeicoes.value,
      fim: aFim.value,
      motivo,
    },
    novaChaveNutricao('alterar-acompanhante'),
  );
async function alterado(r: unknown): Promise<void> {
  erro.value = null;
  mensagem.value = (r as { mensagem: string }).mensagem;
  await Promise.all([mapa.refetch(), acompanhantes.refetch()]);
}
const historicoTexto = (h: AlteracaoHotLida) =>
  [
    t('nutricao.mapa.historicoLinha', {
      evento: t(`nutricao.mapa.eventosHot.${h.evento}`),
      em: instanteCurto(h.em),
      por: h.por,
    }),
    h.antes || h.depois
      ? t('nutricao.mapa.antesDepois', { antes: h.antes ?? '—', depois: h.depois ?? '—' })
      : null,
    h.motivo,
  ]
    .filter(Boolean)
    .join(' · ');
const nomeRefeicao = (c: number) =>
  opcoes.data.value?.refeicoes.find((r) => r.codigo === c)?.nome ?? String(c);
const restricoes = (l: LinhaMapa) =>
  l.caracteristicas.map((c) => (c.resposta ? `${c.nome}: ${c.resposta}` : c.nome)).join(', ');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mapa-titulo" data-testid="tela-mapa-dietas">
    <h1 id="mapa-titulo">
      {{ modoEtiquetas ? t('nutricao.mapa.tituloEtiquetas') : t('nutricao.mapa.titulo') }}
    </h1>
    <p>{{ modoEtiquetas ? t('nutricao.mapa.textoEtiquetas') : t('nutricao.mapa.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/nutricao/triagem">{{ t('nutricao.atalhos.triagem') }}</RouterLink>
    </p>
    <AvisoNutricao :motivo="aviso" />
    <ErroNutricao v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <form class="filtros" data-testid="mapa-filtros" @submit.prevent="abrir">
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('nutricao.mapa.unidade')"
        :opcoes="unidades"
        data-testid="mapa-unidade"
      />
      <SanteSelecao
        v-model="refeicao"
        :rotulo="t('nutricao.mapa.refeicao')"
        :opcoes="refeicoes"
        data-testid="mapa-refeicao"
      />
      <SanteData v-model="data" :rotulo="t('nutricao.mapa.data')" editavel />
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('nutricao.mapa.abrir')"
        data-testid="mapa-abrir"
      />
    </form>
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="mapa-mensagem" />
    <ErroNutricao v-if="erro" :erro="erro" />
    <ErroNutricao v-if="mapa.isError.value" :erro="mapa.error.value" />
    <p v-else-if="consulta && !m" role="status">{{ t('nutricao.carregando') }}</p>
    <template v-else-if="m">
      <p data-testid="mapa-corte">
        <strong
          >{{ m.nomeUnidade }} · {{ m.refeicao.nome }} {{ m.refeicao.horario }} ·
          {{ dataLonga(m.data) }}</strong
        >
        ·
        {{
          t('nutricao.mapa.corte', { hora: m.corteEm.slice(11, 16), data: dataLonga(m.corteEm.slice(0, 10)) })
        }}
        ·
        {{
          m.passouDoCorte
            ? t('nutricao.mapa.depoisDoCorte', { hora: m.corteEm.slice(11, 16) })
            : t('nutricao.mapa.antesDoCorte')
        }}
      </p>
      <p data-testid="mapa-contagens">{{ contagens }}</p>
      <p v-if="m.retrato" class="secundario" data-testid="mapa-retrato">
        {{
          t('nutricao.mapa.fechado', {
            por: m.retrato.por,
            em: instanteCurto(m.retrato.em),
            itens: m.retrato.itens,
            jejuns: m.retrato.jejuns,
          })
        }}
      </p>
      <section v-if="m.alertas.length" class="painel alerta-copa" aria-labelledby="mapa-alertas">
        <h2 id="mapa-alertas">{{ t('nutricao.mapa.alertas') }}</h2>
        <ul class="lista-simples" data-testid="mapa-alertas">
          <li v-for="a in m.alertas" :key="a.internacao">
            {{
              t('nutricao.mapa.alerta', {
                nome: a.nome,
                leito: leitoTexto(a.leito),
                antes: a.antes,
                agora: a.agora,
              })
            }}
          </li>
        </ul>
      </section>
      <div class="acoes">
        <SanteBotao
          v-if="pode('fecharMapa') && !m.retrato"
          :rotulo="t('nutricao.mapa.fechar')"
          :desabilitado="ocupado || !m.passouDoCorte || foraDaJanela"
          data-testid="mapa-fechar"
          @acionar="fechar"
        />
        <span v-if="pode('imprimir')" ref="botaoEtiquetas">
          <SanteBotao
            :variante="modoEtiquetas ? 'primario' : 'secundario'"
            :rotulo="t('nutricao.mapa.etiquetas')"
            :desabilitado="ocupado"
            data-testid="mapa-etiquetas"
            @acionar="gerar"
          />
        </span>
        <a
          v-if="urlEtiquetas && etiquetas"
          :href="urlEtiquetas"
          :download="etiquetas.nomeArquivo"
          data-testid="mapa-baixar-etiquetas"
          >{{ t('nutricao.mapa.baixar') }}</a
        >
      </div>
      <details v-if="etiquetas && etiquetas.conteudo" data-testid="mapa-zpl">
        <summary>{{ t('nutricao.mapa.previa') }}</summary>
        <pre class="zpl" tabindex="0" :aria-label="t('nutricao.mapa.previa')">{{ etiquetas.conteudo }}</pre>
      </details>
      <p v-if="!m.retrato && foraDaJanela" class="secundario" data-testid="mapa-fora-da-janela">
        {{
          t('nutricao.mapa.foraDaJanela', {
            data: dataLonga(m.fechamentoAte.slice(0, 10)),
            hora: m.fechamentoAte.slice(11, 16),
          })
        }}
      </p>
      <SanteCampoTexto
        v-if="m.linhas.length > 0"
        v-model="busca"
        :rotulo="t('nutricao.mapa.buscar')"
        :max-bytes="60"
        data-testid="mapa-busca"
      />
      <p v-if="m.linhas.length === 0">{{ t('nutricao.nenhum') }}</p>
      <p v-else-if="linhas.length === 0" role="status">{{ t('nutricao.mapa.nenhumNaBusca') }}</p>
      <table v-else class="tabela" data-testid="tabela-mapa">
        <caption>
          {{
            t('nutricao.mapa.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.leito') }}</th>
            <th scope="col">{{ t('nutricao.paciente') }}</th>
            <th scope="col">{{ t('nutricao.mapa.dieta') }}</th>
            <th scope="col">{{ t('nutricao.mapa.restricoes') }}</th>
            <th scope="col">{{ t('nutricao.mapa.alergias') }}</th>
            <th scope="col">{{ t('nutricao.mapa.acompanhante') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in linhas"
            :key="l.internacao"
            :data-testid="`mapa-${l.internacao}`"
            :data-tipo="l.tipo"
            :class="{ jejum: l.tipo === 'jejum' }"
          >
            <td>{{ l.leito.acomodacao }} {{ l.leito.leito }}</td>
            <td>
              {{ l.nome }} <span class="secundario">· {{ dataLonga(l.nascimento) }}</span>
            </td>
            <td>
              <strong>{{ t(`nutricao.mapa.tipos.${l.tipo}`) }}</strong>
              <div v-if="l.jejum" :data-testid="`mapa-jejum-${l.internacao}`">
                {{ t(`nutricao.mapa.origens.${l.jejum.origem}`) }}: {{ l.jejum.descricao }}
              </div>
              <div v-if="l.dieta && l.tipo === 'jejum'" class="secundario">{{ l.dieta }}</div>
              <div v-else-if="l.dieta" class="secundario">
                {{ l.dieta }}<span v-if="l.quantidade"> · {{ l.quantidade }}</span>
              </div>
              <strong v-if="l.mudouDepoisDoCorte" class="mudou"> {{ t('nutricao.mapa.mudou') }}</strong>
            </td>
            <td>{{ restricoes(l) }}</td>
            <td>
              <strong v-if="l.alergiasAlimentares.length" class="alergia">{{
                l.alergiasAlimentares.join(', ')
              }}</strong>
            </td>
            <td>
              <span v-if="l.acompanhante">
                {{
                  t('nutricao.mapa.acompanhanteVigente', {
                    base: t(`nutricao.mapa.bases.${l.acompanhante.baseLegal}`),
                    refeicoes: l.acompanhante.refeicoes.map(nomeRefeicao).join(', '),
                  })
                }}
                <em v-if="l.acompanhante.origem === 'portaria'" data-testid="acompanhante-da-portaria">{{
                  t('nutricao.mapa.acompanhanteDaPortaria')
                }}</em>
              </span>
              <SanteBotao
                v-if="pode('acompanhante')"
                variante="texto"
                :rotulo="t('nutricao.mapa.acompanhante')"
                :data-testid="`acompanhante-${l.internacao}`"
                @acionar="abrirAcompanhante(l)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <SanteDialogo
      v-model:visivel="dialogoAcomp"
      :titulo="t('nutricao.mapa.acompanhanteDe', { nome: linhaAcomp?.nome ?? '' })"
      largura="40rem"
    >
      <div class="formulario" data-testid="dialogo-acompanhante">
        <template v-if="vigente">
          <p>
            {{
              t('nutricao.mapa.acompanhanteVigente', {
                base: t(`nutricao.mapa.bases.${vigente.baseLegal}`),
                refeicoes: vigente.refeicoes.map(nomeRefeicao).join(', '),
              })
            }}
          </p>
          <p v-if="vigente.dieta">{{ t('nutricao.mapa.dietaAcompAtual', { dieta: vigente.dieta }) }}</p>
          <div data-testid="acompanhante-historico">
            <strong>{{ t('nutricao.mapa.historicoAcomp') }}</strong>
            <p v-if="vigente.historico.length === 0" class="secundario">
              {{ t('nutricao.mapa.semHistoricoAcomp') }}
            </p>
            <ul v-else class="lista-simples">
              <li v-for="h in vigente.historico" :key="h.id">{{ historicoTexto(h) }}</li>
            </ul>
          </div>
          <SanteBotao
            v-if="pode('acompanhante')"
            variante="secundario"
            :rotulo="t('nutricao.mapa.alterarAcomp')"
            :desabilitado="ocupado"
            data-testid="acompanhante-alterar"
            @acionar="abrirAlterar"
          />
          <SanteCampoTexto
            v-model="motivoEncerrar"
            :rotulo="t('nutricao.mapa.motivoEncerrar')"
            :max-bytes="200"
          />
          <SanteBotao
            variante="destrutivo"
            :confirmacao="t('nutricao.mapa.encerrarConfirma')"
            :rotulo="t('nutricao.mapa.encerrar')"
            :desabilitado="ocupado || motivoEncerrar.trim().length < 5"
            data-testid="acompanhante-encerrar"
            @acionar="encerrar"
          />
        </template>
        <template v-else>
          <SanteSelecao v-model="base" :rotulo="t('nutricao.mapa.baseLegal')" :opcoes="bases" />
          <fieldset class="refeicoes">
            <legend>{{ t('nutricao.mapa.refeicoes') }}</legend>
            <label v-for="r in opcoes.data.value?.refeicoes ?? []" :key="r.codigo">
              <input v-model="refeicoesAcomp" type="checkbox" :value="r.codigo" />
              {{ r.nome }}
            </label>
          </fieldset>
          <SanteData v-model="inicio" :rotulo="t('nutricao.mapa.inicio')" editavel />
          <SanteData v-model="fim" :rotulo="t('nutricao.mapa.fim')" editavel />
          <SanteCampoTexto v-model="obsAcomp" :rotulo="t('nutricao.observacao')" :max-bytes="200" />
          <SanteBotao
            :rotulo="t('nutricao.mapa.registrarAcompanhante')"
            :desabilitado="ocupado || refeicoesAcomp.length === 0 || !inicio"
            data-testid="acompanhante-gravar"
            @acionar="gravarAcompanhante"
          />
        </template>
        <ErroNutricao v-if="erro" :erro="erro" />
      </div>
    </SanteDialogo>
    <DialogoCorrecao
      v-model:visivel="dialogoAlterar"
      :titulo="t('nutricao.mapa.alterarAcomp')"
      :texto="t('nutricao.mapa.alterarAcompTexto')"
      :confirmar="t('nutricao.mapa.alterarAcomp')"
      :incompleto="aRefeicoes.length === 0"
      :gravar="gravarAlteracao"
      @feito="alterado"
    >
      <fieldset class="refeicoes">
        <legend>{{ t('nutricao.mapa.refeicoes') }}</legend>
        <label v-for="r in opcoes.data.value?.refeicoes ?? []" :key="r.codigo">
          <input v-model="aRefeicoes" type="checkbox" :value="r.codigo" />
          {{ r.nome }}
        </label>
      </fieldset>
      <SanteCampoTexto
        v-model="aDieta"
        :rotulo="t('nutricao.mapa.dietaAcomp')"
        :max-bytes="60"
        data-testid="acompanhante-dieta"
      />
      <SanteData v-model="aFim" :rotulo="t('nutricao.mapa.fim')" editavel />
    </DialogoCorrecao>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
tr.jejum td:first-child {
  border-inline-start: 4px solid var(--sgh-aviso);
}
.alergia,
.mudou {
  color: var(--sgh-alerta);
}
.alerta-copa {
  border-color: var(--sgh-alerta);
}
.zpl {
  max-height: 16rem;
  overflow: auto;
  font-size: var(--sgh-fonte-pequena);
}
.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.refeicoes {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.refeicoes legend {
  font-weight: 600;
}
.lista-simples {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-3);
}
</style>
