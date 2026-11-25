<script setup lang="ts">
// Registro clínico no modelo do formulário (ficha do M22, seção 7): `/pep/:paciente/registro/:modelo`. O
// FormRenderer em edição (grade de 12 colunas, teclado, tablet), com o atendimento (a âncora), o horário clínico
// e a justificativa do retroativo; o pré-preenchimento marcado (confirmar); o histórico por pergunta; o rascunho
// (cópia local a cada troca de campo; no servidor a cada minuto e no Ctrl+S) e a finalização (Ctrl+Enter), que
// grava no formato do formulário de origem. As regras de habilitar e calcular rodam aqui e no servidor.
import {
  type RegistrarEvolucaoEntrada,
  type FormularioRegistro,
  type HistoricoPergunta,
  type RespostaRegistro,
  type ValorResposta,
} from '@sgh/contratos';
import { avaliarFormulario, pendenciasParaFinalizar, planos } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  abrirFormulario,
  codigoDoErro,
  descartarRascunho,
  finalizarRegistro,
  lerHistorico,
  listarModelosRegistro,
  novaChave,
  salvarRascunho,
} from '../api-registro.js';
import FormRenderer from '../componentes/formulario/FormRenderer.vue';
import { CONTEXTO_ALERGIA_FORMULARIO } from '../componentes/formulario/contexto-alergia.js';
import { dataHoraBr } from '../formato.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { apagarLocal, chaveLocal, type DonoLocal, guardarLocal, lerLocal } from '../rascunho-local.js';

const props = defineProps<{ paciente: string; modelo: string }>();
const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const idPaciente = computed(() => Number(props.paciente));
const idRascunhoPedido = computed(() => (rota.query['rascunho'] ? Number(rota.query['rascunho']) : null));
/** Correção: o registro suspenso que este corrige (?corrige=, ou o guardado no rascunho de correção). */
const idCorrigePedido = computed(() => (rota.query['corrige'] ? Number(rota.query['corrige']) : null));
/**
 * M23 (regra 10): o registro responde a um parecer da fila (?parecer=) ou é o pedido de parecer
 * (?pedirParecer=categoria&prioridade=&especialidade=&prazoHoras=, escolhidos no "Pedir parecer" do prontuário): o
 * fluxo viaja com o registro e a fila muda na mesma gravação.
 */
const CATEGORIAS_PARECER = new Set([
  'medico',
  'enfermagem',
  'fisioterapia',
  'nutricao',
  'psicologia',
  'fonoaudiologia',
  'odontologia',
  'farmacia',
  'servico-social',
  'outros',
]);
const fluxoParecer = computed<RegistrarEvolucaoEntrada['parecer'] | null>(() => {
  const resposta = Number(rota.query['parecer']);
  if (Number.isInteger(resposta) && resposta > 0) return { tipo: 'resposta', parecer: resposta };
  const cat = rota.query['pedirParecer'];
  if (typeof cat !== 'string' || !CATEGORIAS_PARECER.has(cat)) return null;
  const pr = rota.query['prioridade'];
  const esp = Number(rota.query['especialidade']);
  const prazo = Number(rota.query['prazoHoras']);
  return {
    tipo: 'pedido',
    categoria: cat as NonNullable<
      Extract<RegistrarEvolucaoEntrada['parecer'], { tipo: 'pedido' }>['categoria']
    >,
    prioridade: pr === 'urgente' || pr === 'prioritario' ? pr : 'rotina',
    ...(Number.isInteger(esp) && esp > 0 ? { especialidade: esp } : {}),
    ...(Number.isInteger(prazo) && prazo >= 1 && prazo <= 720 ? { prazoHoras: prazo } : {}),
  };
});
const { sessao } = usarSessao();
/** Dono da cópia local: rede, estabelecimento e login da sessão (sem sessão, nada é guardado nem lido). */
const dono = computed<DonoLocal | null>(() => {
  const s = sessao.value;
  return s && s.estabelecimentoAtivo
    ? { rede: s.rede ?? '', estabelecimento: s.estabelecimentoAtivo, login: s.usuario.login ?? s.usuario.id }
    : null;
});

const modelos = useQuery({
  queryKey: computed(() => ['pep', 'reg', 'modelos', idPaciente.value]),
  queryFn: () => listarModelosRegistro(idPaciente.value),
});
const modelo = computed(
  () =>
    modelos.data.value?.find((m) => (m.codigo ?? '').toUpperCase() === props.modelo.toUpperCase()) ?? null,
);
const formulario = useQuery({
  queryKey: computed(() => [
    'pep',
    'reg',
    'form',
    idPaciente.value,
    modelo.value?.id,
    idRascunhoPedido.value,
  ]),
  queryFn: () => abrirFormulario(idPaciente.value, modelo.value!.id, idRascunhoPedido.value),
  enabled: computed(() => modelo.value !== null),
  staleTime: 0,
});
const f = computed<FormularioRegistro | undefined>(() => formulario.data.value);

// ── Estado da digitação ───────────────────────────────────────────────────────────────────────────
const respostas = reactive<Record<number, RespostaRegistro>>({});
const atendimento = ref<string>('');
// D-ALE-2: o componente de alergia do formulário grava a alergia na hora, ligada ao atendimento escolhido.
provide(
  CONTEXTO_ALERGIA_FORMULARIO,
  computed(() => ({
    paciente: idPaciente.value,
    atendimento: atendimento.value ? Number(atendimento.value) : null,
  })),
);
const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const dataHoraClinica = ref(agoraLocal());
/** Diferença entre o relógio do estabelecimento (servidor) e o deste computador, em milissegundos. */
const desvio = ref(0);
const justificativa = ref('');
const rascunho = ref<{ id: number; versao: string } | null>(null);
const sujo = ref(false);
const mensagem = ref<string | null>(null);
const restaurado = ref(false);
const erro = ref<unknown>(null);
const gravando = ref(false);
const salvoLocalEm = ref<string | null>(null);

const somenteLeitura = computed(() => f.value?.rascunho?.resumo.somenteLeitura === true);
const corrige = computed(() => f.value?.rascunho?.resumo.corrige ?? idCorrigePedido.value);
const podeGravar = computed(() => (f.value?.gravacao.pode ?? false) && !somenteLeitura.value);
const chave = computed(() =>
  dono.value
    ? chaveLocal(
        dono.value,
        idPaciente.value,
        modelo.value?.id ?? 0,
        rascunho.value?.id ?? idRascunhoPedido.value,
      )
    : null,
);

watch(
  f,
  async (x) => {
    if (!x) return;
    for (const k of Object.keys(respostas)) delete respostas[Number(k)];
    // O pré-preenchido (MANTERHIST) nas perguntas sem resposta e, por cima, as respostas do rascunho.
    for (const r of x.preenchidos) respostas[r.vinculo] = r;
    for (const r of x.rascunho?.respostas ?? []) respostas[r.vinculo] = r;
    rascunho.value = x.rascunho ? { id: x.rascunho.resumo.id, versao: x.rascunho.resumo.versao } : null;
    // O horário clínico sugerido é o do relógio do estabelecimento (não o deste computador).
    desvio.value = new Date(`${x.agora}:00`).getTime() - Date.now();
    if (!x.rascunho) dataHoraClinica.value = x.agora;
    if (x.rascunho?.resumo.dataHoraClinica)
      dataHoraClinica.value = x.rascunho.resumo.dataHoraClinica.slice(0, 16);
    const aberto =
      x.atendimentos.find((a) => a.id === x.rascunho?.resumo.atendimento) ??
      x.atendimentos.find((a) => a.aberto) ??
      x.atendimentos[0];
    atendimento.value = aberto ? String(aberto.id) : '';
    // A digitação guardada neste computador, mais nova que o rascunho do servidor, volta.
    const local = dono.value && chave.value ? await lerLocal(dono.value, chave.value) : null;
    const doServidor = x.rascunho?.resumo.atualizadoEm ?? '';
    if (local && !somenteLeitura.value && local.guardadoEm > doServidor) {
      for (const k of Object.keys(respostas)) delete respostas[Number(k)];
      for (const r of local.respostas) respostas[r.vinculo] = r;
      dataHoraClinica.value = local.dataHoraClinica;
      justificativa.value = local.justificativa;
      if (local.atendimento) atendimento.value = String(local.atendimento);
      restaurado.value = true;
      sujo.value = true;
    }
  },
  { immediate: true },
);

const lista = computed(() => Object.values(respostas));
const hoje = computed(() => dataHoraClinica.value.slice(0, 10));
const estado = computed(() =>
  avaliarFormulario(f.value?.campos ?? [], lista.value, { idade: null, sexo: null }, hoje.value),
);
const pendencias = computed(() => pendenciasParaFinalizar(f.value?.campos ?? [], lista.value, estado.value));
const titulosPorVinculo = computed(() => new Map(planos(f.value?.campos ?? []).map((c) => [c.vinculo, c])));
const retroativo = computed(() => {
  const min = (Date.now() + desvio.value - new Date(`${dataHoraClinica.value}:00`).getTime()) / 60_000;
  return min > (f.value?.toleranciaRetroativoMin ?? 15);
});

let tempoLocal: ReturnType<typeof setTimeout> | null = null;
function guardarNoComputador(): void {
  if (tempoLocal) clearTimeout(tempoLocal);
  tempoLocal = setTimeout(() => {
    if (!dono.value || !chave.value) return;
    void guardarLocal(dono.value, chave.value, {
      paciente: idPaciente.value,
      modelo: modelo.value?.id ?? 0,
      atendimento: atendimento.value ? Number(atendimento.value) : null,
      dataHoraClinica: dataHoraClinica.value,
      justificativa: justificativa.value,
      respostas: lista.value,
      rascunho: rascunho.value,
      guardadoEm: new Date().toISOString(),
    }).then(
      () =>
        (salvoLocalEm.value = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
    );
  }, 400);
}

function atualizar(vinculo: number, valor: ValorResposta | null): void {
  if (valor === null) delete respostas[vinculo];
  else {
    const anterior = respostas[vinculo];
    // Mexeu no valor trazido: deixa de ser o trazido (vai sem a marca de pré-preenchido).
    respostas[vinculo] = {
      vinculo,
      valor,
      autopreenchido: false,
      confirmado: false,
      ...(anterior?.autopreenchido && JSON.stringify(anterior.valor) === JSON.stringify(valor)
        ? { autopreenchido: true, confirmado: anterior.confirmado }
        : {}),
    };
  }
  sujo.value = true;
  guardarNoComputador();
}
function confirmar(vinculo: number): void {
  const r = respostas[vinculo];
  if (r) respostas[vinculo] = { ...r, confirmado: true };
  sujo.value = true;
  guardarNoComputador();
}
watch([dataHoraClinica, justificativa, atendimento], () => {
  sujo.value = true;
  guardarNoComputador();
});

function corpoComum() {
  return {
    paciente: idPaciente.value,
    modelo: modelo.value!.id,
    atendimento: Number(atendimento.value),
    dataHoraClinica: dataHoraClinica.value,
    ...(retroativo.value && justificativa.value.trim()
      ? { justificativaRetroativo: justificativa.value.trim() }
      : {}),
    respostas: lista.value,
    ...(corrige.value ? { corrige: corrige.value } : {}),
  };
}

const textoErro = computed(() => {
  const c = codigoDoErro(erro.value);
  const k = c ? `pep.reg.erros.${c}` : null;
  return k && t(k) !== k ? t(k) : null;
});

async function gravarRascunho(automatico = false): Promise<void> {
  if (!podeGravar.value || gravando.value || !atendimento.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await salvarRascunho(
      { ...corpoComum(), ...(rascunho.value ? { rascunho: rascunho.value } : {}) },
      novaChave('rascunho'),
    );
    // Salvar de novo cria a versão encadeada (outro ID, como o legado): a cópia local da versão anterior sai.
    const chaveAnterior = chave.value;
    rascunho.value = { id: r.rascunho, versao: r.versao };
    if (chaveAnterior && chaveAnterior !== chave.value) await apagarLocal(chaveAnterior);
    sujo.value = false;
    mensagem.value = t('pep.reg.registro.salvo', {
      hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    });
    if (!automatico) await cliente.invalidateQueries({ queryKey: ['pep', 'reg', 'rascunhos'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const primeiraPendencia = ref<HTMLElement | null>(null);
/** M23 (regra 3): o residente indica o preceptor que coassina (login); vazio, o registro não pede coassinatura. */
const preceptor = ref('');
async function finalizar(): Promise<void> {
  if (!podeGravar.value || gravando.value || !f.value) return;
  if (pendencias.value.length > 0) {
    await nextTick();
    primeiraPendencia.value?.focus();
    return;
  }
  gravando.value = true;
  erro.value = null;
  try {
    const r = await finalizarRegistro(
      {
        ...corpoComum(),
        impressao: f.value.impressao,
        ...(rascunho.value ? { rascunho: rascunho.value } : {}),
        ...(fluxoParecer.value ? { parecer: fluxoParecer.value } : {}),
        ...(preceptor.value.trim() ? { preceptor: preceptor.value.trim().toUpperCase() } : {}),
      },
      novaChave('evolucao'),
    );
    if (chave.value) await apagarLocal(chave.value);
    sujo.value = false;
    await cliente.invalidateQueries({ queryKey: ['pep', 'reg'] });
    await roteador.push({
      path: `/pep/${idPaciente.value}/registro/${r.registro}`,
      query: { finalizado: '1' },
    });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

async function descartar(): Promise<void> {
  if (!rascunho.value) return;
  try {
    await descartarRascunho(rascunho.value.id, rascunho.value.versao, novaChave('descarte'));
    if (chave.value) await apagarLocal(chave.value);
    await cliente.invalidateQueries({ queryKey: ['pep', 'reg'] });
    await roteador.push('/pep/rascunhos');
  } catch (e) {
    erro.value = e;
  }
}

function irPara(vinculo: number): void {
  const c = titulosPorVinculo.value.get(vinculo);
  const el = c
    ? document.querySelector<HTMLElement>(
        `[data-testid="campo-${c.linkId}"] input, [data-testid="campo-${c.linkId}"] textarea, [data-testid="campo-${c.linkId}"] select`,
      )
    : null;
  el?.focus();
}

// ── Histórico por pergunta ("copiar do último") ──────────────────────────────────────────────────
const historico = ref<HistoricoPergunta | null>(null);
const historicoVisivel = ref(false);
async function abrirHistorico(vinculo: number): Promise<void> {
  if (!modelo.value) return;
  historico.value = await lerHistorico(idPaciente.value, modelo.value.id, vinculo).catch((e: unknown) => {
    erro.value = e;
    return null;
  });
  historicoVisivel.value = historico.value !== null;
}
function copiar(valor: string): void {
  const v = historico.value?.vinculo;
  const c = v !== undefined ? titulosPorVinculo.value.get(v) : undefined;
  if (!c) return;
  const n = Number(valor.replace(',', '.'));
  const novo: ValorResposta | null =
    c.tipo === 'texto-formatado'
      ? {
          tipo: 'formatado',
          paragrafos: valor.split('\n').map((l) => ({
            alinhamento: 'esquerda',
            recuo: 0,
            trechos: l ? [{ texto: l, negrito: false, italico: false, sublinhado: false, cor: 0 }] : [],
          })),
        }
      : c.tipo === 'texto'
        ? { tipo: 'texto', texto: valor }
        : c.tipo === 'quantidade' && Number.isFinite(n)
          ? { tipo: 'numero', valor: n }
          : null;
  if (novo) atualizar(c.vinculo, novo);
  historicoVisivel.value = false;
}

// ── Teclado e salvamento automático ───────────────────────────────────────────────────────────────
function teclar(e: KeyboardEvent): void {
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void gravarRascunho();
  } else if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    void finalizar();
  }
}
let automatico: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  window.addEventListener('keydown', teclar);
  automatico = setInterval(() => {
    if (sujo.value && lista.value.length > 0) void gravarRascunho(true);
  }, 60_000);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', teclar);
  if (automatico) clearInterval(automatico);
  if (tempoLocal) clearTimeout(tempoLocal);
});

const opcoesAtendimento = computed(() =>
  (f.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: t('pep.reg.registro.atendimentoOpcao', {
      tipo: t(`pep.reg.registro.tipos.${a.tipo}`),
      numero: a.numero ?? a.id,
      entrada: dataHoraBr(a.entrada),
      aberto: a.aberto ? t('pep.reg.registro.aberto') : '',
    }),
  })),
);
</script>

<template>
  <section class="tela" aria-labelledby="reg-titulo" data-testid="tela-registro-clinico">
    <h1 id="reg-titulo">
      {{ t('pep.reg.registro.titulo') }}<template v-if="modelo">: {{ modelo.nome }}</template>
    </h1>
    <p>
      <RouterLink :to="`/pep/${idPaciente}/registro`">{{ t('pep.reg.voltar') }}</RouterLink>
    </p>
    <MensagemErro v-if="modelos.isError.value" :erro="modelos.error.value" />
    <p v-else-if="!modelos.data.value" role="status">{{ t('pep.reg.carregando') }}</p>
    <SanteAlerta v-else-if="!modelo" variante="aviso" :texto="t('erros.nao-encontrado.texto')" />
    <MensagemErro v-else-if="formulario.isError.value" :erro="formulario.error.value" />
    <p v-else-if="!f" role="status">{{ t('pep.reg.carregando') }}</p>
    <template v-else>
      <p class="paciente">{{ t('pep.reg.registro.paciente', { n: idPaciente }) }} · {{ f.modelo.codigo }}</p>
      <SanteAlerta
        v-if="!f.gravacao.pode && f.gravacao.motivo"
        variante="info"
        :texto="t('pep.reg.registro.consulta', { motivo: f.gravacao.motivo })"
        data-testid="aviso-consulta"
      />
      <SanteAlerta
        v-if="corrige"
        variante="info"
        :texto="t('pep.reg.registro.correcao', { n: corrige })"
        data-testid="aviso-correcao"
      />
      <SanteAlerta
        v-if="fluxoParecer"
        variante="info"
        :texto="
          t(
            fluxoParecer.tipo === 'resposta'
              ? 'pep.reg.registro.respostaParecer'
              : 'pep.reg.registro.pedidoParecer',
          )
        "
        data-testid="aviso-parecer"
      />
      <SanteAlerta v-if="somenteLeitura" variante="info" :texto="t('pep.reg.registro.soLeitura')" />
      <SanteAlerta v-if="restaurado" variante="info" :texto="t('pep.reg.registro.restaurado')" />
      <SanteAlerta v-for="(a, i) in f.avisos" :key="i" variante="aviso" :texto="a" />
      <section v-if="f.rascunhos.length > 0" class="bloco" aria-labelledby="reg-rascunhos">
        <h2 id="reg-rascunhos">{{ t('pep.reg.registro.rascunhos') }}</h2>
        <ul>
          <li v-for="x in f.rascunhos" :key="x.id">
            <RouterLink
              :to="{ path: `/pep/${idPaciente}/registro/${props.modelo}`, query: { rascunho: x.id } }"
            >
              {{
                t('pep.reg.registro.rascunhoItem', {
                  data: dataHoraBr(x.dataHoraClinica),
                  n: x.respostas,
                  outro: x.somenteLeitura ? t('pep.reg.registro.rascunhoOutro') : '',
                })
              }}
            </RouterLink>
          </li>
        </ul>
      </section>

      <div class="cabecalho-ato">
        <SanteSelecao
          v-if="opcoesAtendimento.length > 0"
          v-model="atendimento"
          :rotulo="t('pep.reg.registro.atendimento')"
          :opcoes="opcoesAtendimento"
          :desabilitado="!podeGravar"
          data-testid="registro-atendimento"
        />
        <SanteAlerta v-else variante="aviso" :texto="t('pep.reg.registro.semAtendimento')" />
        <div class="campo-horario">
          <label for="reg-horario">{{ t('pep.reg.registro.horario') }}</label>
          <input
            id="reg-horario"
            v-model="dataHoraClinica"
            type="datetime-local"
            :disabled="!podeGravar"
            data-testid="registro-horario"
          />
        </div>
      </div>
      <div v-if="retroativo && podeGravar" class="retroativo">
        <SanteAlerta
          variante="aviso"
          :texto="t('pep.reg.registro.retroativo', { min: f.toleranciaRetroativoMin })"
        />
        <label for="reg-justificativa">{{ t('pep.reg.registro.justificativa') }}</label>
        <textarea
          id="reg-justificativa"
          v-model="justificativa"
          maxlength="255"
          rows="2"
          data-testid="registro-justificativa"
        />
      </div>

      <FormRenderer
        :campos="f.campos"
        :respostas="respostas"
        :titulo="f.modelo.nome ?? ''"
        modo="edicao"
        :bloqueado="!podeGravar"
        :desabilitados="estado.desabilitados"
        :calculados="estado.calculados"
        @atualizar="atualizar"
        @confirmar="confirmar"
        @historico="abrirHistorico"
      />

      <section
        v-if="podeGravar && pendencias.length > 0"
        class="bloco pendencias"
        aria-labelledby="reg-pendencias"
        data-testid="pendencias"
      >
        <h2 id="reg-pendencias">{{ t('pep.reg.registro.pendencias') }}</h2>
        <ul>
          <li v-for="(p, i) in pendencias" :key="`${p.vinculo}-${p.motivo}`">
            <button
              :ref="
                (el) => {
                  if (i === 0) primeiraPendencia = el as HTMLElement;
                }
              "
              type="button"
              class="link"
              @click="irPara(p.vinculo)"
            >
              {{ t(`pep.reg.registro.pendencia.${p.motivo}`, { campo: p.titulo }) }}
            </button>
          </li>
        </ul>
      </section>

      <div v-if="erro" class="erro">
        <SanteAlerta v-if="textoErro" variante="alerta" :texto="textoErro" data-testid="erro-registro" />
        <MensagemErro v-else :erro="erro" />
      </div>
      <p v-if="mensagem" role="status" data-testid="mensagem-registro">{{ mensagem }}</p>
      <p v-if="salvoLocalEm" class="nota" role="status">
        {{ t('pep.reg.registro.salvoLocal', { hora: salvoLocalEm }) }}
      </p>
      <label v-if="podeGravar && !fluxoParecer" class="campo-preceptor">
        <span>{{ t('pep.reg.registro.preceptor') }}</span>
        <input
          v-model="preceptor"
          autocomplete="off"
          maxlength="31"
          pattern="[A-Za-z0-9._\-]{1,31}"
          :aria-describedby="'ajuda-preceptor'"
          data-testid="registro-preceptor"
        />
        <small id="ajuda-preceptor">{{ t('pep.reg.registro.preceptorAjuda') }}</small>
      </label>
      <p v-if="podeGravar" class="nota">{{ t('pep.reg.registro.automatico') }}</p>
      <div v-if="podeGravar" class="acoes" role="group" :aria-label="t('pep.reg.registro.titulo')">
        <SanteBotao
          variante="secundario"
          :rotulo="t('pep.reg.registro.salvarRascunho')"
          :desabilitado="gravando || !atendimento"
          data-testid="salvar-rascunho"
          @acionar="gravarRascunho()"
        />
        <SanteBotao
          variante="primario"
          :rotulo="t('pep.reg.registro.finalizar')"
          :desabilitado="gravando || !atendimento"
          data-testid="finalizar-registro"
          @acionar="finalizar"
        />
        <SanteBotao
          v-if="rascunho"
          variante="destrutivo"
          :rotulo="t('pep.reg.registro.descartar')"
          :confirmacao="t('pep.reg.registro.descartarPergunta')"
          data-testid="descartar-rascunho"
          @acionar="descartar"
        />
      </div>

      <SanteDialogo
        v-model:visivel="historicoVisivel"
        :titulo="
          t('pep.reg.registro.historicoTitulo', {
            campo: titulosPorVinculo.get(historico?.vinculo ?? 0)?.titulo ?? '',
          })
        "
      >
        <p v-if="!historico || historico.valores.length === 0">{{ t('pep.reg.registro.historicoVazio') }}</p>
        <ul v-else class="historico" data-testid="historico-pergunta">
          <li v-for="h in historico.valores" :key="h.registro">
            <span class="data">{{ dataHoraBr(h.dataHora) }}</span>
            <span class="valor">{{ h.valor }}</span>
            <SanteBotao variante="texto" :rotulo="t('pep.reg.registro.copiar')" @acionar="copiar(h.valor)" />
          </li>
        </ul>
        <template #rodape>
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.reg.registro.fechar')"
            @acionar="historicoVisivel = false"
          />
        </template>
      </SanteDialogo>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 72rem;
}
.paciente {
  margin: 0;
  color: var(--sgh-texto-secundario);
}
.cabecalho-ato {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
}
.campo-horario,
.retroativo {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.campo-horario label,
.retroativo label {
  font-weight: 600;
}
.campo-horario input,
.retroativo textarea {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  position: sticky;
  bottom: 0;
  background: var(--sgh-fundo);
  padding: var(--sgh-espaco-2) 0;
}
.bloco h2 {
  font-size: 1rem;
  margin: 0 0 var(--sgh-espaco-1);
}
.pendencias {
  border-inline-start: 4px solid var(--sgh-aviso);
  padding-inline-start: var(--sgh-espaco-2);
}
.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--sgh-primaria);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
.nota {
  margin: 0;
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
.historico {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.historico .data {
  font-weight: 600;
  margin-inline-end: var(--sgh-espaco-2);
}
.historico .valor {
  white-space: pre-wrap;
}
</style>
