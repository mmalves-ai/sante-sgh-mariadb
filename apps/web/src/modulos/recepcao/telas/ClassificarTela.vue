<script setup lang="ts">
// Classificar e reclassificar o risco (ficha do M44, seção 7): `/pa/classificacao/:reg` e
// `/pa/classificacao/:reg/reclassificar`. Tela de tablet de 10" (coluna única, alvos de toque grandes). O enfermeiro
// escolhe o fluxograma (com busca), registra os sinais; os discriminadores que a regra marca pelos sinais aparecem
// marcados e travados, os demais ele marca; a cor proposta é a mais grave entre os presentes (regra 3), sempre com o
// nome escrito; mudar a cor exige a justificativa. O técnico de enfermagem registra só os sinais (regra 1). O motor é o
// mesmo do servidor (@sgh/dominio-recepcao): a tela mostra, o servidor reconfere e grava.
import '../componentes/estilo-classificacao.css';
import {
  COMORBIDADES_CLASSIFICACAO,
  type ComorbidadeClassificacao,
  CORES_RISCO,
  type CorRisco,
  VARIAVEIS_CLASSIFICACAO,
} from '@sgh/contratos';
import { discriminadoresDoFluxograma, proporCor, valoresDaClassificacao } from '@sgh/dominio-recepcao';
import { SanteAlerta, SanteBotao, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  classificar,
  lerTelaClassificacao,
  novaChaveClassificacao,
  reclassificar,
  registrarSinaisTriagem,
} from '../api-classificacao.js';
import ErroClassificacao from '../componentes/ErroClassificacao.vue';
import MarcaRisco from '../componentes/MarcaRisco.vue';

const props = withDefaults(defineProps<{ reg: string; modo?: 'classificar' | 'reclassificar' }>(), {
  modo: 'classificar',
});
const { t } = useI18n();
const cliente = useQueryClient();
const reg = computed(() => Number(props.reg));
const tela = useQuery({
  queryKey: computed(() => ['classificacao', 'tela', reg.value]),
  queryFn: () => lerTelaClassificacao(reg.value),
});
const reclass = computed(() => props.modo === 'reclassificar');

// ── Entrada ──────────────────────────────────────────────────────────────────────────────────────
type Sinal = (typeof VARIAVEIS_CLASSIFICACAO)[number];
const SINAIS: readonly Sinal[] = VARIAVEIS_CLASSIFICACAO.filter((v) => v.codigo !== 'idadeAnos');
const entrada = ref<Record<string, string>>({});
const fluxograma = ref('');
const marcados = ref<string[]>([]);
const queixa = ref('');
const observacoes = ref('');
const alergia = ref<'' | 'sim' | 'nao'>('');
const comorbidades = ref<ComorbidadeClassificacao[]>([]);
const corFinal = ref<CorRisco | ''>('');
const justificativa = ref('');
const motivo = ref<'estouro' | 'mudanca_quadro'>('mudanca_quadro');
const descricaoMudanca = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const ocupado = ref(false);

watch(
  () => tela.data.value,
  (d) => {
    if (!d) return;
    const s = d.sinaisRecentes;
    if (s && Object.keys(entrada.value).length === 0)
      for (const v of SINAIS) {
        const x = s[v.codigo as keyof typeof s];
        if (x !== null && x !== undefined) entrada.value[v.codigo] = String(x).replace('.', ',');
      }
    if (d.vigente && !fluxograma.value) fluxograma.value = d.vigente.fluxograma;
    if (d.risco?.reclassificar) motivo.value = 'estouro';
  },
  { immediate: true },
);

const numero = (v: string | undefined): number | null => {
  const s = (v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const sinais = computed(() => {
  const r: Record<string, number | null> = {};
  for (const v of SINAIS) {
    const n = numero(entrada.value[v.codigo]);
    r[v.codigo] = n !== null && n >= v.min && n <= v.max ? (v.inteiro ? Math.round(n) : n) : null;
  }
  return r as {
    pas: number | null;
    pad: number | null;
    fc: number | null;
    fr: number | null;
    temperatura: number | null;
    saturacao: number | null;
    glicemia: number | null;
    dor: number | null;
    glasgow: number | null;
  };
});
const foraDaFaixa = (v: Sinal) => {
  const n = numero(entrada.value[v.codigo]);
  return n !== null && (n < v.min || n > v.max);
};

// ── Motor (o mesmo do servidor) ──────────────────────────────────────────────────────────────────
const conteudo = computed(() => tela.data.value?.protocolo?.conteudo ?? null);
const opcoesFluxograma = computed(() => [
  { valor: '', rotulo: t('classificacao.tela.escolhaFluxograma') },
  ...(conteudo.value?.fluxogramas ?? []).map((f) => ({ valor: f.codigo, rotulo: f.titulo })),
]);
const doFluxograma = computed(() =>
  conteudo.value && fluxograma.value ? discriminadoresDoFluxograma(conteudo.value, fluxograma.value) : [],
);
const proposta = computed(() =>
  conteudo.value && fluxograma.value
    ? proporCor(
        conteudo.value,
        fluxograma.value,
        valoresDaClassificacao(sinais.value, tela.data.value?.atendimento.idade ?? null),
        marcados.value,
      )
    : null,
);
const automaticos = computed(() => new Set(proposta.value?.automaticos ?? []));
watch(fluxograma, () => {
  marcados.value = [];
});
watch(
  () => proposta.value?.cor,
  (c) => {
    if (c) corFinal.value = c;
  },
);
const nomeDaCor = (c: string) => conteudo.value?.cores.find((x) => x.cor === c)?.nome ?? '';
const tempoDaCor = (c: string) => conteudo.value?.cores.find((x) => x.cor === c)?.tempoAlvoMin ?? 0;
const opcoesCor = computed(() =>
  CORES_RISCO.map((c) => ({
    valor: c.codigo as CorRisco,
    rotulo: `${t(`classificacao.cores.${c.codigo}`)} — ${nomeDaCor(c.codigo) || c.nome} (${tempoDaCor(c.codigo)} min)`,
  })),
);
const sobreposta = computed(
  () => !!proposta.value && !!corFinal.value && corFinal.value !== proposta.value.cor,
);
const semPrioridade = computed(
  () => !!corFinal.value && conteudo.value?.cores.find((c) => c.cor === corFinal.value)?.opcaoE08 === null,
);
const opcoesAlergia = computed(() =>
  (['', 'sim', 'nao'] as const).map((v) => ({ valor: v, rotulo: t(`classificacao.tela.alergias.${v}`) })),
);
const opcoesMotivo = computed(() =>
  (['estouro', 'mudanca_quadro'] as const).map((v) => ({
    valor: v,
    rotulo: t(`classificacao.reclassificacao.motivos.${v}`),
  })),
);
const acoes = computed(() => tela.data.value?.acoes ?? []);
const podeConcluir = computed(() => acoes.value.includes(reclass.value ? 'reclassificar' : 'concluir'));
const podeSinais = computed(() => acoes.value.includes('registrarSinais'));
const pronto = computed(
  () =>
    podeConcluir.value &&
    !!fluxograma.value &&
    !!corFinal.value &&
    queixa.value.trim().length >= 2 &&
    (!sobreposta.value || justificativa.value.trim().length >= 10) &&
    (!reclass.value || motivo.value === 'estouro' || descricaoMudanca.value.trim().length >= 10),
);
const temSinal = computed(() => Object.values(sinais.value).some((v) => v !== null));
const hora = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : '—');

function corpo() {
  return {
    versaoProtocolo: tela.data.value!.protocolo!.versao.id,
    fluxograma: fluxograma.value,
    discriminadores: marcados.value,
    sinais: sinais.value,
    queixa: queixa.value.trim(),
    observacoes: observacoes.value.trim() || null,
    alergia: alergia.value || null,
    comorbidades: comorbidades.value,
    corFinal: corFinal.value,
    justificativaSobreposicao: sobreposta.value ? justificativa.value.trim() : null,
    ...(reclass.value
      ? {
          anterior: tela.data.value!.vigente!.id,
          motivo: motivo.value,
          descricaoMudanca: motivo.value === 'mudanca_quadro' ? descricaoMudanca.value.trim() : null,
        }
      : {}),
  };
}

async function concluir(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = reclass.value
      ? await reclassificar(reg.value, corpo(), novaChaveClassificacao('reclassificar'))
      : await classificar(reg.value, corpo(), novaChaveClassificacao('classificar'));
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    await cliente.invalidateQueries({ queryKey: ['classificacao'] });
    await cliente.invalidateQueries({ queryKey: ['atendimento', 'quadro'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function soSinais(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarSinaisTriagem(
      reg.value,
      { sinais: sinais.value },
      novaChaveClassificacao('sinais'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['classificacao'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="tela-agenda tela-tablet"
    aria-labelledby="classificar-titulo"
    :data-testid="reclass ? 'tela-reclassificar' : 'tela-classificar'"
  >
    <ErroClassificacao v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!tela.data.value" role="status">{{ t('classificacao.carregando') }}</p>
    <template v-else>
      <h1 id="classificar-titulo">
        {{
          t(reclass ? 'classificacao.tela.tituloReclassificar' : 'classificacao.tela.titulo', {
            paciente: tela.data.value.atendimento.paciente,
          })
        }}
      </h1>
      <p class="secundario">
        {{ tela.data.value.atendimento.senha ?? t('atendimento.semSenha') }}
        <template v-if="tela.data.value.atendimento.idade !== null">
          · {{ t('atendimento.anos', { n: tela.data.value.atendimento.idade }) }}</template
        >
        · {{ t('classificacao.fila.chegada') }} {{ hora(tela.data.value.atendimento.chegada) }}
      </p>
      <p class="acoes">
        <RouterLink to="/pa/classificacao" data-testid="voltar-fila">{{
          t('classificacao.tela.voltar')
        }}</RouterLink>
      </p>
      <SanteAlerta
        v-if="tela.data.value.motivoSemAcao"
        variante="aviso"
        :texto="tela.data.value.motivoSemAcao"
        data-testid="classificar-motivo"
      />
      <SanteAlerta
        v-if="!tela.data.value.prontuario.ligado"
        variante="info"
        :texto="tela.data.value.prontuario.motivo ?? t('classificacao.tela.prontuarioDesligado')"
        data-testid="classificar-prontuario"
      />
      <section v-if="tela.data.value.vigente" class="painel" data-testid="classificar-vigente">
        <p>
          <MarcaRisco :cor="tela.data.value.vigente.cor" :nome="tela.data.value.vigente.nomeCor" />
          {{
            t('classificacao.reclassificacao.anterior', {
              cor: t(`classificacao.cores.${tela.data.value.vigente.cor}`),
              nome: tela.data.value.vigente.nomeCor,
              hora: hora(tela.data.value.vigente.classificadoEm),
            })
          }}
        </p>
        <p v-if="tela.data.value.risco">
          {{ t('classificacao.tela.risco', { hora: hora(tela.data.value.risco.prazoEm) }) }} ·
          {{
            tela.data.value.risco.minutosRestantes >= 0
              ? t('classificacao.quadro.faltam', { min: tela.data.value.risco.minutosRestantes })
              : t('classificacao.quadro.passou', { min: -tela.data.value.risco.minutosRestantes })
          }}
        </p>
        <SanteAlerta
          v-if="tela.data.value.risco?.reclassificar"
          variante="alerta"
          :texto="t('classificacao.reclassificacao.obrigatoria')"
          data-testid="reclassificacao-obrigatoria"
        />
        <p v-if="tela.data.value.atendimento.atendimentoMedicoEm" class="secundario">
          {{
            t('classificacao.tela.atendimentoMedico', {
              hora: hora(tela.data.value.atendimento.atendimentoMedicoEm),
            })
          }}
        </p>
      </section>
      <template v-if="tela.data.value.protocolo">
        <p class="secundario" data-testid="classificar-protocolo">
          {{
            t('classificacao.tela.protocolo', {
              nome: tela.data.value.protocolo.versao.nome,
              versao: tela.data.value.protocolo.versao.versao,
            })
          }}
        </p>
        <SanteAlerta
          v-if="tela.data.value.protocolo.versao.nome.includes('sintético')"
          variante="aviso"
          :texto="t('classificacao.tela.sintetico')"
        />
        <div class="campo">
          <SanteSelecao
            v-model="fluxograma"
            :rotulo="t('classificacao.tela.fluxograma')"
            :opcoes="opcoesFluxograma"
            :busca="true"
            obrigatorio
            data-testid="classificar-fluxograma"
          />
        </div>
        <fieldset class="painel">
          <legend>{{ t('classificacao.tela.sinais') }}</legend>
          <div class="grade-sinais">
            <div v-for="v in SINAIS" :key="v.codigo" class="campo">
              <label :for="`cl-${v.codigo}`">{{ t(`classificacao.tela.${v.codigo}`) }}</label>
              <input
                :id="`cl-${v.codigo}`"
                v-model="entrada[v.codigo]"
                inputmode="decimal"
                autocomplete="off"
                :aria-invalid="foraDaFaixa(v)"
                :data-testid="`cl-${v.codigo}`"
              />
              <span v-if="foraDaFaixa(v)" class="secundario" role="status">{{
                t('classificacao.tela.sinalForaDaFaixa')
              }}</span>
            </div>
          </div>
        </fieldset>
        <fieldset v-if="fluxograma" class="painel" data-testid="classificar-discriminadores">
          <legend>{{ t('classificacao.tela.discriminadores') }}</legend>
          <label v-for="d in doFluxograma" :key="d.codigo" class="discriminador">
            <input
              v-if="automaticos.has(d.codigo)"
              type="checkbox"
              checked
              disabled
              :data-testid="`disc-${d.codigo}`"
            />
            <input
              v-else
              v-model="marcados"
              type="checkbox"
              :value="d.codigo"
              :data-testid="`disc-${d.codigo}`"
            />
            <span>{{ d.titulo }}</span>
            <MarcaRisco :cor="d.cor" />
            <span v-if="automaticos.has(d.codigo)" class="secundario">{{
              t('classificacao.tela.automatico')
            }}</span>
          </label>
        </fieldset>
        <div class="campo">
          <label for="cl-queixa">{{ t('classificacao.tela.queixa') }}</label>
          <textarea
            id="cl-queixa"
            v-model="queixa"
            rows="2"
            maxlength="2000"
            data-testid="cl-queixa"
          ></textarea>
        </div>
        <div class="campo">
          <SanteSelecao
            v-model="alergia"
            :rotulo="t('classificacao.tela.alergia')"
            :opcoes="opcoesAlergia"
            data-testid="cl-alergia"
          />
        </div>
        <fieldset class="painel">
          <legend>{{ t('classificacao.tela.comorbidades') }}</legend>
          <label v-for="c in COMORBIDADES_CLASSIFICACAO" :key="c" class="discriminador">
            <input v-model="comorbidades" type="checkbox" :value="c" :data-testid="`cl-comorbidade-${c}`" />
            <span>{{ t(`classificacao.tela.comorbidadesOpcoes.${c}`) }}</span>
          </label>
        </fieldset>
        <div class="campo">
          <label for="cl-obs">{{ t('classificacao.tela.observacoes') }}</label>
          <textarea id="cl-obs" v-model="observacoes" rows="2" maxlength="2000"></textarea>
        </div>
        <section v-if="proposta" class="painel" aria-live="polite" data-testid="classificar-proposta">
          <p>
            <MarcaRisco :cor="proposta.cor" :nome="nomeDaCor(proposta.cor)" />
            {{
              t('classificacao.tela.proposta', {
                cor: t(`classificacao.cores.${proposta.cor}`),
                nome: nomeDaCor(proposta.cor),
              })
            }}
          </p>
          <p v-if="proposta.semDiscriminador" class="secundario">
            {{ t('classificacao.tela.semDiscriminador') }}
          </p>
          <div class="campo">
            <SanteSelecao
              v-model="corFinal"
              :rotulo="t('classificacao.tela.corFinal')"
              :opcoes="opcoesCor"
              data-testid="classificar-cor-final"
            />
          </div>
          <p v-if="corFinal">
            {{ t('classificacao.tela.prazoMin', { min: tempoDaCor(corFinal) }) }}
          </p>
          <div v-if="sobreposta" class="campo">
            <label for="cl-justificativa">{{ t('classificacao.tela.justificativa') }}</label>
            <textarea
              id="cl-justificativa"
              v-model="justificativa"
              rows="2"
              maxlength="500"
              aria-describedby="cl-justificativa-ajuda"
              data-testid="cl-justificativa"
            ></textarea>
            <span id="cl-justificativa-ajuda" class="secundario">{{
              t('classificacao.tela.justificativaAjuda')
            }}</span>
          </div>
          <SanteAlerta v-if="semPrioridade" variante="aviso" :texto="t('classificacao.tela.semPrioridade')" />
        </section>
        <section v-if="reclass" class="painel">
          <SanteOpcoes
            v-model="motivo"
            :legenda="t('classificacao.reclassificacao.motivo')"
            :opcoes="opcoesMotivo"
          />
          <div v-if="motivo === 'mudanca_quadro'" class="campo">
            <label for="cl-mudanca">{{ t('classificacao.reclassificacao.descricaoMudanca') }}</label>
            <textarea
              id="cl-mudanca"
              v-model="descricaoMudanca"
              rows="2"
              maxlength="500"
              data-testid="cl-mudanca"
            ></textarea>
          </div>
        </section>
        <div class="acoes">
          <SanteBotao
            v-if="podeConcluir"
            :rotulo="t(reclass ? 'classificacao.reclassificacao.gravar' : 'classificacao.gravar')"
            :desabilitado="!pronto || ocupado"
            data-testid="classificar-concluir"
            @acionar="concluir()"
          />
          <SanteBotao
            v-if="podeSinais && !reclass"
            variante="secundario"
            :rotulo="t('classificacao.tela.registrarSinais')"
            :desabilitado="!temSinal || ocupado"
            data-testid="classificar-sinais"
            @acionar="soSinais()"
          />
        </div>
      </template>
      <p v-if="mensagem" role="status" data-testid="classificar-mensagem">{{ mensagem }}</p>
      <ul v-if="avisos.length" class="lista-simples" data-testid="classificar-avisos">
        <li v-for="a in avisos" :key="a">{{ a }}</li>
      </ul>
      <ErroClassificacao v-if="erro" :erro="erro" />
      <section class="painel" aria-labelledby="cl-historico" data-testid="classificar-historico">
        <h2 id="cl-historico">{{ t('classificacao.tela.historico') }}</h2>
        <p v-if="tela.data.value.historico.length === 0">{{ t('classificacao.tela.semHistorico') }}</p>
        <ul v-else class="lista-simples">
          <li v-for="h in tela.data.value.historico" :key="`${h.origem}-${h.registro}`">
            {{ h.dataHora.slice(0, 10).split('-').reverse().join('/') }} {{ hora(h.dataHora) }} ·
            <MarcaRisco v-if="h.cor" :cor="h.cor" />
            <template v-else>{{ t('classificacao.tela.semPrioridadeHistorico') }}</template>
            · {{ t(`classificacao.tela.origens.${h.origem}`) }}
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
