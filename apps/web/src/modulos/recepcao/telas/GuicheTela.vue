<script setup lang="ts">
// Guichê (ficha do M19, seção 7): `/recepcao/guiche`. Abre o guichê (recepção, local, número), escolhe os serviços,
// chama a próxima senha (a ordem é a do servidor: prioritárias, intercaladas ou pela chegada; a trava é sem espera:
// a senha chamada por outro guichê, aqui ou em outro terminal, nunca vem duas vezes) e conduz a senha no guichê
// (chamar de novo, suspender com motivo, não localizado, concluir o serviço diverso, registrar a chegada do
// agendado). As suspensas voltam pela lista; as em atendimento nos locais podem ser encaminhadas aos locais
// permitidos. Teclado: F6 chama a próxima, F7 chama de novo, F8 não localizado. A fila relê a cada 5 s.
import {
  type PedidoGravacao,
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteDialogo,
  SanteDialogoGravacao,
  SanteSelecao,
} from '@sgh/ui';
import { type AgendadoDoDia, GRUPOS_PRIORIDADE, type SenhaLida } from '@sgh/contratos';
import { eventosPossiveis } from '@sgh/dominio-recepcao';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import {
  abrirGuiche,
  chamarProxima,
  codigoDaRecusa,
  desfazerChegada,
  emitirNoBalcao,
  fecharGuiche,
  lerAgendados,
  lerApoio,
  lerFila,
  lerGravacao,
  lerTermosDoPaciente,
  novaChave,
  registrarChegada,
  registrarEvento,
} from '../api-recepcao.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import ChegadaSemProntuario from '../componentes/ChegadaSemProntuario.vue';
import TermosPaciente from '../componentes/TermosPaciente.vue';
import { horaDe } from '../formato.js';

const { t, te } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['recepcao', 'apoio'], queryFn: () => lerApoio(), staleTime: 15_000 });
const gravacao = useQuery({
  queryKey: ['recepcao', 'gravacao'],
  queryFn: () => lerGravacao(),
  staleTime: 30_000,
});
const pode = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.pode ?? false);
const podeChamar = pode('recepcao.chamarSenha');
const podeEmitir = pode('recepcao.emitirSenha');
const podeChegada = pode('recepcao.registrarChegada');
const podeDesfazerChegada = pode('recepcao.desfazerChegada');
const podeEncaminhar = computed(() => podePermissao('recepcao.senha.encaminhar'));
const podeFluxo = computed(() => podePermissao('recepcao.fluxo.registrar'));
// M20: a senha chamada abre o atendimento (a ficha liga a senha e a põe em atendimento).
const podeAbrirAtendimento = computed(() => podePermissao('atendimento.atendimento.abrir'));
const podeSupervisor = computed(() => podePermissao('recepcao.supervisor.ler'));
// 02-AGE 42: converter na chegada o pré-cadastro de quem marcou sem prontuário (lê os marcados do dia na agenda).
const podeConverterPreCadastro = computed(
  () => podePermissao('cadastro.paciente.criar') && podePermissao('agenda.marcacao.ler'),
);
const podeTermos = computed(() => podePermissao('recepcao.termo.editar'));

const recepcao = ref('');
const local = ref('');
const guiche = ref('');
const servicos = ref<number[]>([]);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// O guichê já aberto por esta pessoa (aqui ou em outro terminal) preenche a escolha.
watch(
  () => apoio.data.value,
  (a) => {
    if (!a || recepcao.value) return;
    const meu = a.meuGuiche;
    const r = meu ? a.recepcoes.find((x) => x.id === meu.recepcao) : a.recepcoes[0];
    if (!r) return;
    recepcao.value = String(r.id);
    local.value = String(meu?.local ?? r.locais.find((l) => l.ativo)?.id ?? '');
    guiche.value = meu ? String(meu.guiche) : '';
    servicos.value = r.geradores.filter((g) => g.ativo).map((g) => g.id);
  },
  { immediate: true },
);
const rec = computed(() => apoio.data.value?.recepcoes.find((r) => String(r.id) === recepcao.value) ?? null);
watch(recepcao, () => {
  const r = rec.value;
  if (!r) return;
  if (!r.locais.some((l) => String(l.id) === local.value))
    local.value = String(r.locais.find((l) => l.ativo)?.id ?? '');
  servicos.value = r.geradores.filter((g) => g.ativo).map((g) => g.id);
});
const opcoesRecepcao = computed(() =>
  (apoio.data.value?.recepcoes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
);
const opcoesLocal = computed(() =>
  (rec.value?.locais ?? []).filter((l) => l.ativo).map((l) => ({ valor: String(l.id), rotulo: l.descricao })),
);
const geradores = computed(() => (rec.value?.geradores ?? []).filter((g) => g.ativo));
const numero = computed(() => {
  const n = Number(guiche.value);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : 0;
});
const pronto = computed(() => !!recepcao.value && !!local.value && numero.value > 0);
const outros = computed(() =>
  (apoio.data.value?.guichesEmUso ?? [])
    .filter((g) => String(g.recepcao) === recepcao.value && g.ocupadoPor === 'outro')
    .map((g) => g.guiche)
    .sort((a, b) => a - b),
);
const fila = useQuery({
  queryKey: computed(() => [
    'recepcao',
    'fila',
    recepcao.value,
    local.value,
    numero.value,
    servicos.value.join(','),
  ]),
  queryFn: () =>
    lerFila({
      recepcao: Number(recepcao.value),
      local: Number(local.value),
      guiche: numero.value,
      geradores: servicos.value,
    }),
  enabled: pronto,
  refetchInterval: 5_000,
});
const aberto = computed(() => fila.data.value?.guicheAberto ?? false);
const atual = computed<SenhaLida | null>(() => fila.data.value?.noGuiche[0] ?? null);
const nomeLocal = (id: number | null) =>
  apoio.data.value?.recepcoes.flatMap((r) => r.locais).find((l) => l.id === id)?.descricao ?? '';
const nomeServico = (s: SenhaLida) => s.servico;
const prioridadeTexto = (p: string) => t(`recepcao.prioridades.${p === '0' || p === '1' ? p : '2'}`);

async function acao(
  fn: () => Promise<{ mensagem: string }>,
  depois?: (r: { mensagem: string }) => void,
): Promise<void> {
  ocupado.value = true;
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    depois?.(r);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
    await cliente.invalidateQueries({ queryKey: ['recepcao'] });
  }
}
const g = () => ({ recepcao: Number(recepcao.value), local: Number(local.value), guiche: numero.value });
const abrir = () => acao(() => abrirGuiche(g(), novaChave('abrir')));
const fechar = () => acao(() => fecharGuiche(g(), novaChave('fechar')));
const chamar = (senha?: number) =>
  acao(() =>
    chamarProxima({ ...g(), geradores: servicos.value, ...(senha ? { senha } : {}) }, novaChave('chamar')),
  );
const evento = (s: SenhaLida, ev: string, extra: Record<string, unknown> = {}) =>
  acao(() =>
    registrarEvento(
      s.id,
      {
        evento: ev,
        local:
          ev === 'encaminhar' || ev === 'cancelarChamada' || ev === 'naoLocalizadoNoLocal'
            ? (s.ultimoLocal ?? Number(local.value))
            : Number(local.value),
        guiche:
          ev === 'encaminhar' || ev === 'cancelarChamada' || ev === 'naoLocalizadoNoLocal' ? 0 : numero.value,
        ...extra,
      },
      novaChave(ev),
    ),
  );
const possiveis = (s: SenhaLida) =>
  eventosPossiveis(
    { situacao: s.situacao, guiche: s.guiche, atendida: s.atendida, tipoGerador: s.tipoGerador },
    numero.value,
  );

// ── Suspender (motivo padronizado) ──
const suspensao = ref<SenhaLida | null>(null);
const motivo = ref('DESISTIU');
const complemento = ref('');
const opcoesMotivo = computed(() =>
  (apoio.data.value?.motivosSuspensao ?? [])
    .filter((m) => m.codigo !== 'NAO-LOCALIZADO')
    .map((m) => ({ valor: m.codigo, rotulo: m.texto })),
);
const suspensaoAberta = computed({
  get: () => suspensao.value !== null,
  set: (v) => (v ? null : (suspensao.value = null)),
});
async function confirmarSuspensao(): Promise<void> {
  const s = suspensao.value;
  if (!s) return;
  suspensao.value = null;
  await evento(s, 'suspender', {
    motivo: motivo.value,
    ...(motivo.value === 'OUTRO' ? { complemento: complemento.value } : {}),
  });
}

// ── Encaminhar (só aos locais permitidos) ──
const encaminhamento = ref<SenhaLida | null>(null);
const destino = ref('');
const destinos = computed(() => {
  const s = encaminhamento.value;
  const l = apoio.data.value?.recepcoes.flatMap((r) => r.locais).find((x) => x.id === s?.ultimoLocal);
  return (l?.encaminha ?? []).map((id) => ({ valor: String(id), rotulo: nomeLocal(id) || String(id) }));
});
const encaminhamentoAberto = computed({
  get: () => encaminhamento.value !== null,
  set: (v) => (v ? null : (encaminhamento.value = null)),
});
watch(destinos, (d) => (destino.value = d[0]?.valor ?? ''));
async function confirmarEncaminhamento(): Promise<void> {
  const s = encaminhamento.value;
  if (!s || !destino.value) return;
  encaminhamento.value = null;
  await evento(s, 'encaminhar', { destino: Number(destino.value) });
}

// ── Emitir no balcão ──
const emissaoAberta = ref(false);
const servicoEmissao = ref('');
const grupoEmissao = ref('');
const servicoEscolhido = computed(() => geradores.value.find((x) => String(x.id) === servicoEmissao.value));
const opcoesServico = computed(() =>
  geradores.value.map((x) => ({ valor: String(x.id), rotulo: `${x.letra} · ${x.nome}` })),
);
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: t('recepcao.guiche.semPrioridade') },
  ...(servicoEscolhido.value?.prioritaria
    ? GRUPOS_PRIORIDADE.filter((x) => x.prioridade !== '2').map((x) => ({
        valor: String(x.grupo),
        rotulo: x.rotulo,
      }))
    : []),
]);
watch(emissaoAberta, (v) => {
  if (v) {
    servicoEmissao.value = String(geradores.value[0]?.id ?? '');
    grupoEmissao.value = '';
  }
});
async function confirmarEmissao(): Promise<void> {
  const gerador = Number(servicoEmissao.value);
  emissaoAberta.value = false;
  const grupo = GRUPOS_PRIORIDADE.find((x) => String(x.grupo) === grupoEmissao.value) ?? null;
  await acao(() =>
    emitirNoBalcao(
      { gerador, prioridade: grupo?.prioridade ?? '2', grupo: grupo?.grupo ?? null },
      novaChave('emitir'),
    ),
  );
}

// ── Chegada do agendado ──
const chegada = ref<SenhaLida | null>(null);
// A busca da chegada: CPF (11 dígitos), prontuário e parte do nome da agenda; aplicada pelo botão "Buscar".
const buscaCpf = ref('');
const buscaProntuario = ref('');
const buscaAgenda = ref('');
const filtroAgendados = ref<{ cpf: string | null; prontuario: number | null; agenda: string | null }>({
  cpf: null,
  prontuario: null,
  agenda: null,
});
const buscaValida = computed(
  () =>
    (buscaCpf.value === '' || /^\d{11}$/.test(buscaCpf.value)) &&
    (buscaProntuario.value === '' || /^\d{1,10}$/.test(buscaProntuario.value)) &&
    (buscaAgenda.value.trim() === '' || buscaAgenda.value.trim().length >= 2),
);
function buscarAgendados(): void {
  if (!buscaValida.value) return;
  filtroAgendados.value = {
    cpf: buscaCpf.value || null,
    prontuario: buscaProntuario.value ? Number(buscaProntuario.value) : null,
    agenda: buscaAgenda.value.trim() || null,
  };
}
watch(chegada, (v) => {
  if (!v) return;
  buscaCpf.value = '';
  buscaProntuario.value = '';
  buscaAgenda.value = '';
  filtroAgendados.value = { cpf: null, prontuario: null, agenda: null };
});
const agendados = useQuery({
  queryKey: computed(() => ['recepcao', 'agendados', filtroAgendados.value]),
  queryFn: () => lerAgendados(filtroAgendados.value),
  enabled: computed(() => chegada.value !== null),
});
const chegadaAberta = computed({
  get: () => chegada.value !== null,
  set: (v) => (v ? null : (chegada.value = null)),
});
// W1-04: antes de ligar, os termos exigidos no tipo de atendimento. Faltando termo, o diálogo mostra os termos do
// paciente (assinatura em tela; bloqueio suave pede a confirmação) e o botão final registra a chegada.
const termosDe = ref<{ agendado: AgendadoDoDia; chegada: boolean } | null>(null);
watch(chegada, () => (termosDe.value = null));
async function registrar(tipo: 'consulta' | 'exame', marcacao: number): Promise<void> {
  const s = chegada.value;
  if (!s) return;
  chegada.value = null;
  await acao(() => registrarChegada(s.id, { tipo, marcacao }, novaChave('chegada')));
}
async function ligar(a: AgendadoDoDia): Promise<void> {
  let faltando = 0;
  try {
    faltando = (await lerTermosDoPaciente(a.prontuario, a.tipo)).faltando.length;
  } catch {
    // Sem a leitura dos termos (permissão ou falha), a chegada segue: o bloqueio é só suave.
  }
  if (faltando > 0) termosDe.value = { agendado: a, chegada: true };
  else await registrar(a.tipo, a.marcacao);
}

// W1-04: desfazer a chegada (fato novo com motivo; a marcação volta ao estado anterior; ficha aberta recusa).
const dialogoGravacao = ref(false);
const pedidoGravacao = ref<PedidoGravacao | null>(null);
function pedirDesfazer(s: SenhaLida): void {
  pedidoGravacao.value = {
    titulo: t('recepcao.guiche.desfazerTitulo', { senha: s.texto }),
    texto: t('recepcao.guiche.desfazerTexto'),
    motivo: t('recepcao.guiche.desfazerMotivo'),
    senha: false,
    confirmar: t('recepcao.guiche.desfazerChegada'),
    gravar: async ({ motivo: m }) => {
      const r = await desfazerChegada(s.id, m, novaChave('desfazer'));
      mensagem.value = r.mensagem;
      erro.value = null;
    },
  };
  dialogoGravacao.value = true;
}
async function aposGravacao(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['recepcao'] });
}
function falhaGravacao(e: unknown): void {
  mensagem.value = null;
  erro.value = e;
}

const textoErro = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`recepcao.recusas.${c}`) ? t(`recepcao.recusas.${c}`) : null;
});

function aoTeclar(e: KeyboardEvent): void {
  if (!aberto.value || ocupado.value || !podeChamar.value) return;
  if (e.key === 'F6') {
    e.preventDefault();
    void chamar();
  } else if (e.key === 'F7' && atual.value) {
    e.preventDefault();
    void evento(atual.value, 'rechamar');
  } else if (e.key === 'F8' && atual.value) {
    e.preventDefault();
    void evento(atual.value, 'naoLocalizado');
  }
}
onMounted(() => window.addEventListener('keydown', aoTeclar));
onBeforeUnmount(() => window.removeEventListener('keydown', aoTeclar));
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="guiche-titulo" data-testid="tela-guiche">
    <h1 id="guiche-titulo">{{ t('recepcao.guiche.titulo') }}</h1>
    <p>{{ t('recepcao.guiche.texto') }}</p>
    <div
      v-if="gravacao.data.value && !gravacao.data.value.ligada"
      class="aviso"
      data-testid="recepcao-em-consulta"
    >
      <SanteAlerta variante="aviso" :texto="t('recepcao.emConsulta')" />
      <p>{{ gravacao.data.value.motivo }}</p>
    </div>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!apoio.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <template v-else>
      <div class="filtros">
        <SanteSelecao
          v-model="recepcao"
          :rotulo="t('recepcao.recepcao')"
          :opcoes="opcoesRecepcao"
          data-testid="guiche-recepcao"
        />
        <SanteSelecao
          v-model="local"
          :rotulo="t('recepcao.local')"
          :opcoes="opcoesLocal"
          data-testid="guiche-local"
        />
        <div class="campo">
          <label for="guiche-numero">{{ t('recepcao.guiche.numero') }}</label>
          <input
            id="guiche-numero"
            v-model="guiche"
            type="number"
            min="1"
            max="99"
            inputmode="numeric"
            data-testid="guiche-numero"
          />
        </div>
        <SanteBotao
          v-if="!aberto"
          :rotulo="t('recepcao.guiche.abrir')"
          :desabilitado="!pronto || ocupado || !podeChamar"
          data-testid="guiche-abrir"
          @acionar="abrir"
        />
        <SanteBotao
          v-else
          variante="secundario"
          :rotulo="t('recepcao.guiche.fechar')"
          :desabilitado="ocupado"
          data-testid="guiche-fechar"
          @acionar="fechar"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('recepcao.guiche.emitir')"
          :desabilitado="!podeEmitir || ocupado || geradores.length === 0"
          data-testid="guiche-emitir"
          @acionar="emissaoAberta = true"
        />
      </div>
      <fieldset class="servicos">
        <legend>{{ t('recepcao.servicos') }}</legend>
        <label v-for="x in geradores" :key="x.id">
          <input v-model="servicos" type="checkbox" :value="x.id" :data-testid="`servico-${x.id}`" />
          {{ x.letra }} · {{ x.nome
          }}<template v-if="x.prioritaria"> ({{ t('recepcao.geradores.prioritaria') }})</template>
        </label>
      </fieldset>
      <p v-if="outros.length" class="secundario" data-testid="guiches-outros">
        {{ t('recepcao.guiche.ocupadoPorOutro', { lista: outros.join(', ') }) }}
      </p>
      <p v-if="podeSupervisor">
        <RouterLink to="/recepcao/supervisor">{{ t('recepcao.guiche.supervisor') }}</RouterLink>
      </p>
      <p v-if="podeTermos">
        <RouterLink to="/recepcao/termos" data-testid="link-termos">{{
          t('recepcao.termos.titulo')
        }}</RouterLink>
      </p>
      <div v-if="erro" role="alert" data-testid="recusa-recepcao">
        <SanteAlerta v-if="textoErro" variante="alerta" :texto="textoErro" />
        <MensagemErro v-else :erro="erro" />
      </div>
      <p v-if="mensagem" role="status" data-testid="mensagem-recepcao">{{ mensagem }}</p>

      <MensagemErro v-if="fila.isError.value" :erro="fila.error.value" />
      <template v-else-if="fila.data.value">
        <p role="status" data-testid="guiche-situacao">
          {{
            aberto
              ? t('recepcao.guiche.aberto', { guiche: numero, local: nomeLocal(Number(local)) })
              : t('recepcao.guiche.fechado')
          }}
          · {{ t('recepcao.guiche.atualizado', { agora: horaDe(fila.data.value.agora) }) }}
        </p>
        <section class="painel atual" aria-labelledby="guiche-atual" data-testid="guiche-atual">
          <h2 id="guiche-atual">{{ t('recepcao.guiche.atual') }}</h2>
          <div class="acoes-linha">
            <SanteBotao
              :rotulo="t('recepcao.guiche.chamarProxima')"
              :desabilitado="!aberto || ocupado || !podeChamar || servicos.length === 0"
              data-testid="chamar-proxima"
              @acionar="chamar()"
            />
          </div>
          <p class="secundario">{{ t('recepcao.guiche.atalhos') }}</p>
          <p v-if="!atual">{{ t('recepcao.guiche.nenhumaAtual') }}</p>
          <ul v-else class="senhas-no-guiche">
            <li
              v-for="(s, i) in fila.data.value.noGuiche"
              :key="s.id"
              :class="{ 'senha-atual': i === 0 }"
              :data-testid="`no-guiche-${s.id}`"
            >
              <strong class="senha-grande" :data-testid="i === 0 ? 'senha-atual' : 'senha-no-guiche'">{{
                s.texto
              }}</strong>
              <span v-if="i === 0 && fila.data.value.noGuiche.length > 1" class="secundario">{{
                t('recepcao.guiche.ultimaChamada')
              }}</span>
              <span>
                {{ nomeServico(s) }} · {{ prioridadeTexto(s.prioridade) }} ·
                {{ t(`recepcao.situacoes.${s.situacao}`) }} ·
                {{ t('recepcao.guiche.chamadas', { n: s.chamadas }) }}
                <template v-if="s.agendamento"> · {{ t('recepcao.guiche.agendado') }}</template>
              </span>
              <div class="acoes-linha">
                <RouterLink
                  v-if="
                    podeAbrirAtendimento &&
                    ['aguardando', 'chamada', 'suspensa', 'nao_compareceu'].includes(s.situacao)
                  "
                  :to="`/recepcao/atendimento/novo?senha=${s.id}&local=${local}`"
                  :data-testid="i === 0 ? 'abrir-atendimento-atual' : `abrir-atendimento-guiche-${s.id}`"
                  >{{ t('recepcao.guiche.abrirAtendimento') }}</RouterLink
                >
                <SanteBotao
                  v-for="ev in possiveis(s).filter((x) =>
                    ['rechamar', 'naoLocalizado', 'liberar'].includes(x),
                  )"
                  :key="ev"
                  variante="secundario"
                  :rotulo="t(`recepcao.eventos.${ev}`)"
                  :desabilitado="ocupado || !podeChamar"
                  :data-testid="i === 0 ? `evento-${ev}` : `evento-${ev}-${s.id}`"
                  @acionar="evento(s, ev)"
                />
                <SanteBotao
                  v-if="possiveis(s).includes('suspender')"
                  variante="secundario"
                  :rotulo="t('recepcao.eventos.suspender')"
                  :desabilitado="ocupado || !podeChamar"
                  :data-testid="i === 0 ? 'evento-suspender' : `evento-suspender-${s.id}`"
                  @acionar="suspensao = s"
                />
                <SanteBotao
                  v-if="!s.agendamento && s.tipoGerador === '0'"
                  variante="secundario"
                  :rotulo="t('recepcao.guiche.checkin')"
                  :desabilitado="ocupado || !podeChegada"
                  :data-testid="i === 0 ? 'evento-checkin' : `evento-checkin-${s.id}`"
                  @acionar="chegada = s"
                />
                <SanteBotao
                  v-if="s.agendamento && podeDesfazerChegada"
                  variante="secundario"
                  :rotulo="t('recepcao.guiche.desfazerChegada')"
                  :desabilitado="ocupado"
                  :data-testid="i === 0 ? 'evento-desfazer-chegada' : `evento-desfazer-chegada-${s.id}`"
                  @acionar="pedirDesfazer(s)"
                />
              </div>
            </li>
          </ul>
        </section>

        <table class="tabela" data-testid="tabela-aguardando">
          <caption>
            {{
              t('recepcao.guiche.aguardando', { n: fila.data.value.aguardando.length })
            }}
            —
            {{
              t('recepcao.guiche.aguardandoLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('recepcao.senha') }}</th>
              <th scope="col">{{ t('recepcao.servico') }}</th>
              <th scope="col">{{ t('recepcao.prioridade') }}</th>
              <th scope="col">{{ t('recepcao.espera') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('recepcao.guiche.chamarEsta') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in fila.data.value.aguardando" :key="s.id" :data-testid="`aguardando-${s.id}`">
              <td>
                <strong>{{ s.texto }}</strong>
                <template v-if="s.origem"> · {{ t(`recepcao.origem.${s.origem}`) }}</template>
              </td>
              <td>{{ s.servico }}</td>
              <td>{{ prioridadeTexto(s.prioridade) }}</td>
              <td>{{ t('recepcao.minutos', { n: s.esperaMinutos }) }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('recepcao.guiche.chamarEstaRotulo', { senha: s.texto })"
                  :desabilitado="!aberto || ocupado || !podeChamar"
                  @acionar="chamar(s.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <table v-if="fila.data.value.suspensas.length" class="tabela" data-testid="tabela-suspensas">
          <caption>
            {{
              t('recepcao.guiche.suspensas', { n: fila.data.value.suspensas.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('recepcao.senha') }}</th>
              <th scope="col">{{ t('recepcao.servico') }}</th>
              <th scope="col">{{ t('recepcao.indicadores.situacao') }}</th>
              <th scope="col">{{ t('recepcao.espera') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('recepcao.eventos.retomar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in fila.data.value.suspensas" :key="s.id">
              <td>
                <strong>{{ s.texto }}</strong>
              </td>
              <td>{{ s.servico }}</td>
              <td :data-testid="`suspensa-situacao-${s.id}`">{{ t(`recepcao.situacoes.${s.situacao}`) }}</td>
              <td>{{ t('recepcao.minutos', { n: s.esperaMinutos }) }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('recepcao.eventos.retomar')"
                  :desabilitado="!aberto || ocupado || !podeChamar"
                  :data-testid="`retomar-${s.id}`"
                  @acionar="evento(s, 'retomar')"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <table v-if="fila.data.value.emAtendimento.length" class="tabela" data-testid="tabela-em-atendimento">
          <caption>
            {{
              t('recepcao.guiche.emAtendimento', { n: fila.data.value.emAtendimento.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('recepcao.senha') }}</th>
              <th scope="col">{{ t('recepcao.local') }}</th>
              <th scope="col">{{ t('recepcao.prioridade') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('recepcao.eventos.encaminhar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in fila.data.value.emAtendimento"
              :key="s.id"
              :data-testid="`em-atendimento-${s.id}`"
            >
              <td>
                <strong>{{ s.texto }}</strong> · {{ t(`recepcao.situacoes.${s.situacao}`) }}
              </td>
              <td>{{ nomeLocal(s.ultimoLocal) }}</td>
              <td>{{ prioridadeTexto(s.prioridade) }}</td>
              <td class="acoes-linha">
                <SanteBotao
                  v-if="podeEncaminhar"
                  variante="texto"
                  :rotulo="t('recepcao.eventos.encaminhar')"
                  :desabilitado="ocupado"
                  :data-testid="`encaminhar-${s.id}`"
                  @acionar="encaminhamento = s"
                />
                <template v-if="podeFluxo && s.situacao === 'chamada'">
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('recepcao.eventos.cancelarChamada')"
                    :desabilitado="ocupado"
                    @acionar="evento(s, 'cancelarChamada')"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('recepcao.eventos.naoLocalizadoNoLocal')"
                    :desabilitado="ocupado"
                    @acionar="evento(s, 'naoLocalizadoNoLocal')"
                  />
                </template>
                <RouterLink
                  v-if="
                    podeAbrirAtendimento &&
                    ['aguardando', 'chamada', 'suspensa', 'nao_compareceu'].includes(s.situacao)
                  "
                  :to="`/recepcao/atendimento/novo?senha=${s.id}&local=${local}`"
                  :data-testid="`abrir-atendimento-${s.id}`"
                  >{{ t('recepcao.guiche.abrirAtendimento') }}</RouterLink
                >
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <SanteDialogo
      v-model:visivel="suspensaoAberta"
      :titulo="t('recepcao.guiche.suspenderTitulo', { senha: suspensao?.texto ?? '' })"
    >
      <div class="formulario">
        <SanteSelecao
          v-model="motivo"
          :rotulo="t('recepcao.guiche.motivo')"
          :opcoes="opcoesMotivo"
          data-testid="motivo-suspensao"
        />
        <SanteCampoTexto
          v-if="motivo === 'OUTRO'"
          v-model="complemento"
          :rotulo="t('recepcao.guiche.complemento')"
          :max-bytes="40"
        />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="suspensao = null" />
        <SanteBotao
          :rotulo="t('recepcao.eventos.suspender')"
          data-testid="confirmar-suspensao"
          @acionar="confirmarSuspensao"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="encaminhamentoAberto"
      :titulo="t('recepcao.guiche.encaminharTitulo', { senha: encaminhamento?.texto ?? '' })"
    >
      <p v-if="destinos.length === 0">{{ t('recepcao.guiche.semDestino') }}</p>
      <SanteSelecao
        v-else
        v-model="destino"
        :rotulo="t('recepcao.guiche.destino')"
        :opcoes="destinos"
        data-testid="destino-encaminhamento"
      />
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="encaminhamento = null" />
        <SanteBotao
          :rotulo="t('recepcao.eventos.encaminhar')"
          :desabilitado="!destino"
          data-testid="confirmar-encaminhamento"
          @acionar="confirmarEncaminhamento"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="emissaoAberta" :titulo="t('recepcao.guiche.emitirTitulo')">
      <div class="formulario">
        <SanteSelecao
          v-model="servicoEmissao"
          :rotulo="t('recepcao.servico')"
          :opcoes="opcoesServico"
          data-testid="emissao-servico"
        />
        <SanteSelecao
          v-model="grupoEmissao"
          :rotulo="t('recepcao.guiche.grupo')"
          :opcoes="opcoesGrupo"
          data-testid="emissao-grupo"
        />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="emissaoAberta = false" />
        <SanteBotao
          :rotulo="t('recepcao.guiche.emitir')"
          :desabilitado="!servicoEmissao"
          data-testid="confirmar-emissao"
          @acionar="confirmarEmissao"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="chegadaAberta"
      :titulo="t('recepcao.guiche.checkinTitulo', { senha: chegada?.texto ?? '' })"
      largura="44rem"
    >
      <template v-if="termosDe">
        <h3>
          {{
            t(termosDe.chegada ? 'recepcao.termos.tituloChegada' : 'recepcao.termos.tituloPaciente', {
              nome: termosDe.agendado.paciente,
            })
          }}
        </h3>
        <TermosPaciente
          :prontuario="termosDe.agendado.prontuario"
          :tipo="termosDe.agendado.tipo"
          :senha="chegada?.id ?? null"
          :chegada="termosDe.chegada && !termosDe.agendado.chegou"
          @mensagem="(m) => (mensagem = m)"
          @seguir="registrar(termosDe.agendado.tipo, termosDe.agendado.marcacao)"
        />
      </template>
      <template v-else>
        <p>{{ t('recepcao.guiche.checkinTexto') }}</p>
        <ChegadaSemProntuario v-if="podeConverterPreCadastro" @convertido="agendados.refetch()" />
        <form class="filtros" data-testid="busca-agendados" @submit.prevent="buscarAgendados">
          <SanteCampoTexto
            v-model="buscaCpf"
            :rotulo="t('recepcao.guiche.buscaCpf')"
            :max-bytes="11"
            data-testid="busca-cpf"
          />
          <SanteCampoTexto
            v-model="buscaProntuario"
            :rotulo="t('recepcao.guiche.buscaProntuario')"
            :max-bytes="10"
            data-testid="busca-prontuario"
          />
          <SanteCampoTexto
            v-model="buscaAgenda"
            :rotulo="t('recepcao.guiche.buscaAgenda')"
            :max-bytes="40"
            data-testid="busca-agenda"
          />
          <SanteBotao
            :rotulo="t('recepcao.guiche.buscar')"
            :desabilitado="!buscaValida"
            data-testid="buscar-agendados"
            @acionar="buscarAgendados"
          />
        </form>
        <MensagemErro v-if="agendados.isError.value" :erro="agendados.error.value" />
        <p v-else-if="!agendados.data.value" role="status">{{ t('recepcao.carregando') }}</p>
        <template v-else>
          <SanteAlerta
            v-if="agendados.data.value.cortada"
            variante="aviso"
            :texto="t('recepcao.guiche.agendadosCortados')"
            data-testid="agendados-cortados"
          />
          <p v-if="agendados.data.value.itens.length === 0" role="status" data-testid="agendados-vazio">
            {{ t('recepcao.guiche.semAgendados') }}
          </p>
        </template>
        <ul v-if="agendados.data.value" class="agendados" data-testid="lista-agendados">
          <li v-for="a in agendados.data.value.itens" :key="`${a.tipo}-${a.marcacao}`">
            <!-- Espaço da foto para conferir a identidade (cadastro do paciente); vazio sem foto ou se sigiloso. -->
            <img
              v-if="a.foto"
              class="foto-paciente"
              :src="a.foto"
              :alt="t('recepcao.guiche.fotoAlt', { nome: a.paciente })"
              :data-testid="`foto-${a.tipo}-${a.marcacao}`"
            />
            <span
              v-else
              class="foto-paciente foto-vazia"
              role="img"
              :aria-label="a.sigiloso ? t('recepcao.guiche.fotoSigilosa') : t('recepcao.guiche.semFoto')"
              :data-testid="`sem-foto-${a.tipo}-${a.marcacao}`"
            />
            <span
              >{{ a.hora }} · {{ a.agenda }} · {{ a.paciente
              }}<template v-if="a.chegou"> · {{ t('recepcao.guiche.chegou') }}</template></span
            >
            <span
              v-if="a.nomeSocial"
              class="marca-ident"
              :data-testid="`nome-social-${a.tipo}-${a.marcacao}`"
              >{{ t('recepcao.guiche.marcaNomeSocial') }}</span
            >
            <span
              v-if="a.sigiloso"
              class="marca-ident sigiloso"
              :data-testid="`sigiloso-${a.tipo}-${a.marcacao}`"
              >{{ t('recepcao.guiche.marcaSigiloso') }}</span
            >
            <SanteBotao
              v-if="!a.chegou"
              variante="texto"
              :rotulo="t('recepcao.guiche.ligarRotulo', { hora: a.hora, agenda: a.agenda })"
              :data-testid="`ligar-${a.tipo}-${a.marcacao}`"
              @acionar="ligar(a)"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('recepcao.guiche.termos')"
              :aria-label="t('recepcao.guiche.termosRotulo', { hora: a.hora, agenda: a.agenda })"
              :data-testid="`termos-${a.tipo}-${a.marcacao}`"
              @acionar="termosDe = { agendado: a, chegada: false }"
            />
          </li>
        </ul>
      </template>
      <template #rodape>
        <SanteBotao
          v-if="termosDe"
          variante="secundario"
          :rotulo="t('recepcao.guiche.voltarLista')"
          data-testid="termos-voltar"
          @acionar="termosDe = null"
        />
        <SanteBotao variante="secundario" :rotulo="t('recepcao.fechar')" @acionar="chegada = null" />
      </template>
    </SanteDialogo>

    <SanteDialogoGravacao
      v-model:visivel="dialogoGravacao"
      :pedido="pedidoGravacao"
      :testids="{ motivo: 'desfazer-motivo', confirmar: 'desfazer-confirmar' }"
      @feito="aposGravacao"
      @falha="falhaGravacao"
    />
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
