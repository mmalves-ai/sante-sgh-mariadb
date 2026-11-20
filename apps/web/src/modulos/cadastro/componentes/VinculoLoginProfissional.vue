<script setup lang="ts">
// D-PROF-39, requisito 1 do dono: o login do sistema do profissional (é por ele que o profissional vê os próprios
// atendimentos e registra como profissional). Ligar, trocar e desligar pedem a senha de novo e a justificativa (fica no
// histórico: SBIS NGS1.03.09 d).
// Login único por profissional (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): o profissional com o mesmo
// conselho em várias ocupações (CBOs) tem UM login, ligado a UMA ocupação (o registro que o login usa, como o cadastro
// anterior). A aba mostra o login e a ocupação, com Ligar (login + ocupação; padrão a de médico ativa mais recente),
// Trocar o login, Trocar a ocupação (move a ligação) e Desligar. Um seletor de login só. O dado herdado com logins
// diferentes aparece todo (também dois no MESMO registro: cada ligação registro + login), com o aviso e o Desligar de
// cada um (nunca se esconde). Revisão: com uma ocupação só, o combo de ocupação não aparece (ela aparece escrita, entra
// direto e o diálogo a cita).
// O combo de logins tem busca (ADR 0027) e só traz os livres e os deste profissional (a nota diz a condição: papel
// Operador de sistema ativo); sem registro ativo, o aviso diz que o login não fará ato de profissional.
// Revisão: o vínculo é a identidade clínica — só quem gere os acessos liga, troca ou desliga (e ninguém o próprio);
// sem a permissão ou com a gravação recusada pelo executor, a aba mostra o login só para consulta.
import { type FichaProfissional, loginsDistintosDoProfissional, tipoDoProblema } from '@sgh/contratos';
import { type PedidoGravacao, SanteAlerta, SanteBotao, SanteDialogoGravacao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { lerLoginsProfissional, vincularLoginProfissional } from '../api-cadastro.js';
import {
  ativoDaFicha,
  conselhoDoRegistro,
  ocupacaoDoRegistro,
  ocupacaoPadraoDoLogin,
  ocupacoesParaLogin,
  operacaoLigada,
  PERMISSAO_VINCULO_LOGIN,
  registroReal,
} from '../profissional-tela.js';

// loginSugerido: o login do atalho "Profissional vinculado" da ficha do usuário (?login=), pré-escolhido no combo quando
// ele é uma das opções (livre ou deste profissional).
const props = defineProps<{ ficha: FichaProfissional; loginSugerido?: string }>();
const emit = defineEmits<{ gravado: [] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`cadastro.profissionais.tela.${k}`, p ?? {});
const editar = computed(
  () => pode(PERMISSAO_VINCULO_LOGIN) && operacaoLigada(props.ficha, 'cadastro.vincularLoginProfissional'),
);
const logins = useQuery({
  queryKey: ['cadastro', 'profissionais', 'logins'],
  queryFn: () => lerLoginsProfissional(),
  enabled: editar,
});
type Registro = FichaProfissional['registros'][number];
const reais = computed(() => props.ficha.registros.filter(registroReal));
const registroPorId = (id: number) => props.ficha.registros.find((r) => r.id === id);
/** "225125 · MÉDICO CLÍNICO — CRM 12345/MG", com a marca de inativo. */
const rotuloOcupacao = (r: Registro | undefined, id = 0) =>
  r
    ? `${ocupacaoDoRegistro(r)} — ${conselhoDoRegistro(r)}${r.ativo === false ? ` · ${T('inativo')}` : ''}`
    : T('ocupacaoDesconhecida', { id });

// As ligações lidas (registro → login) e a situação do profissional: sem login, um login, ou dado herdado com mais de um.
const ligacoes = computed(() => props.ficha.loginsRegistro ?? []);
const distintos = computed(() => loginsDistintosDoProfissional(ligacoes.value));
const conflito = computed(() => distintos.value.length > 1);
const unico = computed(() => (distintos.value.length === 1 ? distintos.value[0]! : ''));
/** O registro (ocupação) que o login único usa. */
const ligacaoUnica = computed(() =>
  unico.value ? ligacoes.value.find((x) => x.login.trim().toUpperCase() === unico.value) : undefined,
);
const loginDe = (registro: number) => ligacoes.value.find((x) => x.registro === registro)?.login ?? '';
const semAtivo = computed(() => !ativoDaFicha(props.ficha));

// O seletor de login (um só) e o de ocupação.
const opcoesLogin = computed(() => [
  { valor: '', rotulo: T('escolhaLogin') },
  ...(logins.data.value ?? [])
    .filter((l) => l.profissional === null || l.profissional === props.ficha.id)
    .filter((l) => l.login !== unico.value)
    .map((l) => ({ valor: l.login, rotulo: l.nome ? `${l.login} · ${l.nome}` : l.login })),
]);
const ocupacoes = computed(() => ocupacoesParaLogin(props.ficha.registros));
/** Ligar: todas as ocupações possíveis. Trocar a ocupação: as outras (não a que o login já usa). */
const opcoesOcupacao = computed(() => [
  { valor: '', rotulo: T('escolhaOcupacao') },
  ...ocupacoes.value
    .filter((r) => !unico.value || r.id !== ligacaoUnica.value?.registro)
    .map((r) => ({ valor: String(r.id), rotulo: rotuloOcupacao(r) })),
]);
const escolhaLogin = ref('');
watch(
  opcoesLogin,
  (ops) => {
    const s = props.loginSugerido ?? '';
    if (s && !escolhaLogin.value && ops.some((o) => o.valor === s)) escolhaLogin.value = s;
  },
  { immediate: true },
);
const escolhaOcupacao = ref<string | null>(null);
/** Ao ligar, a ocupação começa na padrão (a de médico ativa mais recente); ao trocar, vazia. */
const ocupacaoEscolhida = computed(() => {
  if (escolhaOcupacao.value !== null) return escolhaOcupacao.value;
  if (unico.value || conflito.value) return '';
  const padrao = ocupacaoPadraoDoLogin(props.ficha.registros);
  return padrao === null ? '' : String(padrao);
});

const recusa = ref('');
const erro = ref<unknown>(null);
const aviso = ref('');
const dialogo = ref(false);
const pedido = ref<PedidoGravacao | null>(null);

function abrir(
  titulo: string,
  texto: string,
  confirmar: string,
  registro: number,
  login: string | null,
  versao: string,
): void {
  pedido.value = {
    titulo,
    texto,
    // Toda mudança do vínculo leva a justificativa (também a primeira ligação).
    motivo: T('justificativa'),
    motivoObrigatorio: true,
    ...(login && semAtivo.value ? { alerta: T('semRegistroAtivo') } : {}),
    senha: true,
    confirmar,
    gravar: ({ motivo, senha }) =>
      vincularLoginProfissional(props.ficha.id, { registro, login, versao, justificativa: motivo }, senha),
  };
  dialogo.value = true;
}
function limpar(): void {
  recusa.value = '';
  erro.value = null;
  aviso.value = '';
}

/** Ligar (sem login) ou trocar o login (no registro que o login único usa). */
function ligarOuTrocar(): void {
  limpar();
  const login = escolhaLogin.value;
  if (!login) {
    recusa.value = T('escolhaLogin');
    return;
  }
  const lig = ligacaoUnica.value;
  if (lig) {
    const r = registroPorId(lig.registro);
    abrir(
      T('trocarTitulo'),
      T('trocarTexto', { antes: unico.value, depois: login, ocupacao: rotuloOcupacao(r, lig.registro) }),
      T('trocar'),
      lig.registro,
      login,
      lig.login,
    );
    return;
  }
  const registro = Number(ocupacaoEscolhida.value);
  if (!registro) {
    recusa.value = T('escolhaOcupacao');
    return;
  }
  abrir(
    T('ligarTitulo'),
    T('ligarTexto', { login, ocupacao: rotuloOcupacao(registroPorId(registro), registro) }),
    T('ligar'),
    registro,
    login,
    loginDe(registro),
  );
}

/** Trocar a ocupação: o MESMO login vai para outro registro ativo do profissional (o anterior fica sem login). */
function trocarOcupacao(): void {
  limpar();
  const lig = ligacaoUnica.value;
  const destino = Number(ocupacaoEscolhida.value);
  if (!lig || !destino) {
    recusa.value = T('escolhaOcupacao');
    return;
  }
  abrir(
    T('trocarOcupacaoTitulo'),
    T('trocarOcupacaoTexto', {
      login: unico.value,
      antes: rotuloOcupacao(registroPorId(lig.registro), lig.registro),
      depois: rotuloOcupacao(registroPorId(destino), destino),
    }),
    T('trocarOcupacao'),
    destino,
    unico.value,
    loginDe(destino),
  );
}

function desligar(l: { registro: number; login: string }): void {
  limpar();
  abrir(
    T('desligarTitulo'),
    T('desligarTexto', { login: l.login, ocupacao: rotuloOcupacao(registroPorId(l.registro), l.registro) }),
    T('desligar'),
    l.registro,
    null,
    l.login,
  );
}

function feito(): void {
  aviso.value = T('loginGravado');
  escolhaLogin.value = '';
  escolhaOcupacao.value = null;
  emit('gravado');
}
function falha(e: unknown): void {
  const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
  if (
    (tipo === 'recusa-de-negocio' || tipo === 'conflito-de-versao' || tipo === 'entrada-invalida') &&
    e instanceof ErroApi &&
    e.problema
  )
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
  else erro.value = e;
}
</script>

<template>
  <section class="cartao" aria-labelledby="login-titulo" data-testid="login-profissional">
    <h2 id="login-titulo" class="cartao__titulo">{{ T('loginTitulo') }}</h2>
    <p class="nota">{{ T('loginTexto') }}</p>
    <p v-if="editar" class="nota" data-testid="login-condicao">{{ T('loginCondicao') }}</p>
    <p v-else class="nota" data-testid="login-so-consulta">{{ T('loginSoConsulta') }}</p>
    <p v-if="editar && logins.isPending.value" role="status" data-testid="logins-carregando">
      {{ T('carregandoLogins') }}
    </p>
    <SanteAlerta
      v-if="semAtivo"
      :texto="T('semRegistroAtivo')"
      variante="aviso"
      data-testid="login-sem-ativo"
    />
    <SanteAlerta
      v-if="conflito"
      :texto="T('loginConflito', { n: distintos.length })"
      variante="aviso"
      data-testid="login-conflito"
    />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="login-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="login-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="logins.isError.value" :erro="logins.error.value" />
    <p v-if="reais.length === 0">{{ T('semRegistroLogin') }}</p>

    <!-- O que está ligado: o login e a ocupação que ele usa (no dado herdado, cada ligação). -->
    <p v-if="ligacoes.length === 0 && reais.length > 0" data-testid="login-nenhum">
      <span class="pilula pilula--neutra">{{ T('semLogin') }}</span>
    </p>
    <div v-for="l in ligacoes" :key="`${l.registro}|${l.login}`" class="linha" data-testid="login-ligacao">
      <dl class="fatos">
        <div>
          <dt>{{ T('loginAtual') }}</dt>
          <dd>
            <span class="etiqueta" data-testid="login-atual">{{ l.login }}</span>
          </dd>
        </div>
        <div>
          <dt>{{ T('ocupacaoDoLogin') }}</dt>
          <dd data-testid="login-ocupacao-atual">
            {{ rotuloOcupacao(registroPorId(l.registro), l.registro) }}
          </dd>
        </div>
      </dl>
      <div v-if="editar" class="acoes">
        <SanteBotao
          :rotulo="T('desligar')"
          variante="secundario"
          data-testid="login-desligar"
          @acionar="desligar(l)"
        />
      </div>
    </div>

    <!-- Ações: ligar (sem login) ou trocar o login e trocar a ocupação (um login). No conflito, só desligar. -->
    <template v-if="editar && reais.length > 0 && !conflito">
      <div class="acoes acoes--bloco" data-testid="login-acao-login">
        <SanteSelecao
          v-model="escolhaLogin"
          :rotulo="unico ? T('loginNovoTroca') : T('loginNovo')"
          :opcoes="opcoesLogin"
          busca
          data-testid="login-escolha"
        />
        <SanteSelecao
          v-if="!unico && ocupacoes.length > 1"
          :model-value="ocupacaoEscolhida"
          :rotulo="T('ocupacao')"
          :opcoes="opcoesOcupacao"
          data-testid="login-ocupacao-escolha"
          @update:model-value="(v: unknown) => (escolhaOcupacao = String(v ?? ''))"
        />
        <!-- Uma ocupação só: sem combo sem escolha; ela aparece escrita e entra direto no pedido. -->
        <dl v-if="!unico && ocupacoes.length === 1" class="fatos" data-testid="login-ocupacao-unica">
          <div>
            <dt>{{ T('ocupacao') }}</dt>
            <dd>{{ rotuloOcupacao(ocupacoes[0]) }}</dd>
          </div>
        </dl>
        <SanteBotao
          :rotulo="unico ? T('trocar') : T('ligar')"
          variante="primario"
          data-testid="login-gravar"
          @acionar="ligarOuTrocar"
        />
      </div>
      <div
        v-if="unico && opcoesOcupacao.length > 1"
        class="acoes acoes--bloco"
        data-testid="login-acao-ocupacao"
      >
        <SanteSelecao
          :model-value="ocupacaoEscolhida"
          :rotulo="T('ocupacaoNova')"
          :opcoes="opcoesOcupacao"
          data-testid="login-ocupacao-escolha"
          @update:model-value="(v: unknown) => (escolhaOcupacao = String(v ?? ''))"
        />
        <SanteBotao
          :rotulo="T('trocarOcupacao')"
          variante="secundario"
          data-testid="login-trocar-ocupacao"
          @acionar="trocarOcupacao"
        />
      </div>
    </template>
    <SanteDialogoGravacao v-model:visivel="dialogo" :pedido="pedido" @feito="feito" @falha="falha" />
  </section>
</template>

<style scoped>
.linha {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-2) 0;
  border-top: 1px solid var(--sgh-borda);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.acoes--bloco {
  padding: var(--sgh-espaco-2) 0;
  border-top: 1px solid var(--sgh-borda);
}
</style>
