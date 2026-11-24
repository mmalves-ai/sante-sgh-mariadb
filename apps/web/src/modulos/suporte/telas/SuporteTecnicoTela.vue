<script setup lang="ts">
// Tela "Suporte técnico" (ADR 0021), da conta da PLATAFORMA (não do alvo): aba Suportes (cadastrar por e-mail,
// ativar e desativar a função, marcar os estabelecimentos), aba Auditoria (sessões, escritas com a marca dos
// atos clínicos e dos não reversíveis, leituras agregadas, encerrar sessão aberta, a trilha do legado com o
// autor real e o "Corrigir" com PRÉVIA) e aba Mudanças de função. O suporte vê só a Auditoria das próprias
// sessões (para corrigir o que registrou errado nos estabelecimentos atribuídos).
import type {
  AuditoriaContaTela,
  ContaPlataformaTela,
  CruzamentoTrilhaTela,
  DetalheSessaoComoTela,
  EstabelecimentoComo,
  EuPlataforma,
  PreviaCorrecaoTela,
  SessaoComoTela,
} from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { mensagensContaEmail } from '../i18n-conta-email.js';
import {
  alterarEmailConta,
  buscarEu,
  corrigir,
  criarSuporte,
  definirAtribuicoes,
  definirFuncao,
  detalheSessao,
  encerrarSessao,
  estabelecimentosComo,
  eventosContas,
  gerarConvite,
  listarSessoes,
  listarSuportes,
  trilhaLegado,
} from '../api-suporte.js';

const { t, locale, mergeLocaleMessage } = useI18n();
mergeLocaleMessage(locale.value, mensagensContaEmail);
const roteador = useRouter();
const eu = ref<EuPlataforma | null>(null);
const aba = ref<'suportes' | 'auditoria' | 'contas'>('auditoria');
const contas = ref<ContaPlataformaTela[]>([]);
const estabelecimentos = ref<EstabelecimentoComo[]>([]);
const sessoes = ref<SessaoComoTela[]>([]);
const filtro = ref('');
const detalhe = ref<DetalheSessaoComoTela | null>(null);
const trilha = ref<CruzamentoTrilhaTela[]>([]);
const previa = ref<PreviaCorrecaoTela | null>(null);
const pedidoPrevia = ref<{ estabelecimento: string; sessao: string; acao?: string } | null>(null);
const confirmarConflito = ref(false);
const eventos = ref<AuditoriaContaTela[]>([]);
const novoEmail = ref('');
const novoNome = ref('');
const convite = ref('');
const mensagem = ref('');
const marcados = ref<Record<string, string[]>>({});
const suportes = computed(() => contas.value.filter((c) => c.papel === 'SUPORTE'));
/** Conta com o e-mail em edição (a própria ou a de um suporte) e o valor digitado. */
const editandoEmail = ref<string | null>(null);
const emailNovo = ref('');

function editarEmail(id: string, atual: string): void {
  editandoEmail.value = id;
  emailNovo.value = atual;
  mensagem.value = '';
}

async function salvarEmail(): Promise<void> {
  const id = editandoEmail.value;
  if (!id) return;
  try {
    await alterarEmailConta(id, emailNovo.value);
    editandoEmail.value = null;
    mensagem.value = t('suporte.emailAlterado');
    if (eu.value && id === eu.value.conta.id) eu.value = await buscarEu();
    await carregarContas();
  } catch (e) {
    mensagem.value =
      e instanceof ErroApi && e.status === 409 ? t('suporte.emailEmUso') : t('suporte.erroSalvar');
  }
}

function linkConvite(token: string, ate: string): string {
  return t('suporte.convite', {
    ate: new Date(ate).toLocaleString('pt-BR'),
    link: `${window.location.origin}/plataforma/convite?token=${token}`,
  });
}

async function carregarContas(): Promise<void> {
  contas.value = await listarSuportes();
  marcados.value = Object.fromEntries(
    contas.value.map((c) => [c.id, c.atribuicoes.map((a) => a.estabelecimento)]),
  );
}

const opcoesFiltro = computed(() => [
  { valor: '', rotulo: t('suporte.todos') },
  ...estabelecimentos.value.map((e) => ({ valor: e.codigo, rotulo: e.nome })),
]);

async function carregarSessoes(): Promise<void> {
  sessoes.value = await listarSessoes(filtro.value);
}

onMounted(async () => {
  try {
    eu.value = await buscarEu();
  } catch {
    await roteador.replace('/entrar');
    return;
  }
  estabelecimentos.value = await estabelecimentosComo().catch(() => []);
  if (eu.value.podeDesignar) {
    aba.value = 'suportes';
    await carregarContas().catch(() => undefined);
  }
  await carregarSessoes().catch(() => undefined);
});

async function cadastrar(): Promise<void> {
  mensagem.value = '';
  try {
    const r = await criarSuporte({
      email: novoEmail.value,
      ...(novoNome.value ? { nome: novoNome.value } : {}),
    });
    convite.value = linkConvite(r.convite.token, r.convite.expiraEm);
    novoEmail.value = '';
    novoNome.value = '';
    await carregarContas();
  } catch {
    mensagem.value = t('suporte.erroSalvar');
  }
}

async function alternar(c: ContaPlataformaTela): Promise<void> {
  await definirFuncao(c.id, !c.ativo).catch(() => (mensagem.value = t('suporte.erroSalvar')));
  await carregarContas();
}

async function salvarAtribuicoes(c: ContaPlataformaTela): Promise<void> {
  try {
    await definirAtribuicoes(c.id, marcados.value[c.id] ?? []);
    mensagem.value = t('suporte.salvo');
    await carregarContas();
  } catch {
    mensagem.value = t('suporte.erroSalvar');
  }
}

async function reconvidar(c: ContaPlataformaTela): Promise<void> {
  const r = await gerarConvite(c.id).catch(() => null);
  if (r) convite.value = linkConvite(r.token, r.expiraEm);
}

async function ver(s: SessaoComoTela): Promise<void> {
  previa.value = null;
  detalhe.value = await detalheSessao(s.id);
  trilha.value = await trilhaLegado(s.id).catch(() => []);
}

async function encerrar(s: SessaoComoTela): Promise<void> {
  await encerrarSessao(s.id).catch(() => (mensagem.value = t('suporte.erroSalvar')));
  await carregarSessoes();
}

async function pedirPrevia(acao?: string): Promise<void> {
  const d = detalhe.value;
  if (!d) return;
  pedidoPrevia.value = {
    estabelecimento: d.sessao.estabelecimento,
    sessao: d.sessao.id,
    ...(acao ? { acao } : {}),
  };
  confirmarConflito.value = false;
  previa.value = (await corrigir({ ...pedidoPrevia.value, previa: true })) as PreviaCorrecaoTela;
}

async function executar(): Promise<void> {
  if (!pedidoPrevia.value || !detalhe.value) return;
  try {
    if (!previa.value) return;
    // A execução leva o resumo da prévia mostrada: se algo mudou depois, o servidor recusa (409).
    const r = (await corrigir({
      ...pedidoPrevia.value,
      previa: false,
      resumo: previa.value.resumo,
      ...(confirmarConflito.value ? { confirmarConflito: true } : {}),
    })) as { corrigidos: number };
    mensagem.value = t('suporte.corrigidos', { n: r.corrigidos });
    previa.value = null;
    detalhe.value = await detalheSessao(detalhe.value.sessao.id);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 409) {
      // O registro (ou a sessão) mudou depois da prévia: mostra a prévia nova; nada foi feito.
      mensagem.value = t('suporte.previaMudou');
      const acao = pedidoPrevia.value.acao;
      await pedirPrevia(acao).catch(() => undefined);
      return;
    }
    mensagem.value = t('suporte.erroSalvar');
  }
}

async function abrirContas(): Promise<void> {
  aba.value = 'contas';
  eventos.value = await eventosContas().catch(() => []);
}

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
</script>

<template>
  <section v-if="eu" class="suporte" aria-labelledby="suporte-titulo">
    <h1 id="suporte-titulo">
      {{ eu.podeDesignar ? t('suporte.suporteTecnico') : t('suporte.minhasSessoes') }}
    </h1>
    <div class="suporte__abas" role="tablist">
      <button
        v-if="eu.podeDesignar"
        type="button"
        role="tab"
        :aria-selected="aba === 'suportes'"
        data-testid="aba-suportes"
        @click="aba = 'suportes'"
      >
        {{ t('suporte.abaSuportes') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="aba === 'auditoria'"
        data-testid="aba-auditoria"
        @click="aba = 'auditoria'"
      >
        {{ t('suporte.abaAuditoria') }}
      </button>
      <button
        v-if="eu.podeDesignar"
        type="button"
        role="tab"
        :aria-selected="aba === 'contas'"
        @click="abrirContas"
      >
        {{ t('suporte.abaContas') }}
      </button>
    </div>
    <p v-if="mensagem" role="status" data-testid="suporte-mensagem">{{ mensagem }}</p>

    <div v-if="aba === 'suportes'" role="tabpanel">
      <section class="suporte__minha-conta" data-testid="minha-conta">
        <h2>{{ t('suporte.minhaConta') }}</h2>
        <p>
          <span data-testid="minha-conta-email">{{ eu.conta.email }}</span>
          <button
            v-if="editandoEmail !== eu.conta.id"
            type="button"
            data-testid="alterar-meu-email"
            @click="editarEmail(eu.conta.id, eu.conta.email)"
          >
            {{ t('suporte.alterarEmail') }}
          </button>
        </p>
      </section>
      <form v-if="editandoEmail" class="suporte__novo" data-testid="form-email" @submit.prevent="salvarEmail">
        <label>
          <span>{{ t('suporte.novoEmail') }}</span>
          <input v-model="emailNovo" type="email" required maxlength="254" data-testid="novo-email" />
        </label>
        <SanteBotao :rotulo="t('suporte.salvarEmail')" tipo="submit" data-testid="salvar-email" />
        <button type="button" @click="editandoEmail = null">{{ t('suporte.cancelar') }}</button>
      </form>
      <form class="suporte__novo" @submit.prevent="cadastrar">
        <label>
          <span>{{ t('suporte.email') }}</span>
          <input v-model="novoEmail" type="email" required data-testid="novo-suporte-email" />
        </label>
        <label>
          <span>{{ t('suporte.nome') }}</span>
          <input v-model="novoNome" maxlength="120" />
        </label>
        <SanteBotao :rotulo="t('suporte.cadastrar')" tipo="submit" data-testid="novo-suporte" />
      </form>
      <p v-if="convite" class="suporte__convite" data-testid="convite">{{ convite }}</p>
      <table class="suporte__tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('suporte.email') }}</th>
            <th scope="col">{{ t('suporte.ativo') }}</th>
            <th scope="col">{{ t('suporte.atribuicoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in suportes" :key="c.id" :data-testid="`suporte-${c.email}`">
            <td>
              {{ c.email }}
              <small v-if="!c.senhaDefinida"> · {{ t('suporte.senhaPendente') }}</small>
              <small v-if="c.segundoFator"> · {{ t('suporte.segundoFatorAtivo') }}</small>
              <button type="button" @click="reconvidar(c)">{{ t('suporte.novoConvite') }}</button>
              <button
                type="button"
                :data-testid="`alterar-email-${c.email}`"
                @click="editarEmail(c.id, c.email)"
              >
                {{ t('suporte.alterarEmail') }}
              </button>
            </td>
            <td>
              <button type="button" :data-testid="`funcao-${c.email}`" @click="alternar(c)">
                {{ c.ativo ? t('suporte.desativar') : t('suporte.ativar') }}
              </button>
            </td>
            <td>
              <label v-for="e in estabelecimentos" :key="e.codigo" class="suporte__marca">
                <input
                  v-model="marcados[c.id]"
                  type="checkbox"
                  :value="e.codigo"
                  :data-testid="`atribuir-${c.email}-${e.codigo}`"
                />
                {{ e.nome }}
              </label>
              <button type="button" :data-testid="`salvar-${c.email}`" @click="salvarAtribuicoes(c)">
                {{ t('suporte.salvarAtribuicoes') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="aba === 'auditoria'" role="tabpanel">
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('suporte.filtrarEstabelecimento')"
        :opcoes="opcoesFiltro"
        @update:model-value="carregarSessoes"
      />
      <table class="suporte__tabela" data-testid="sessoes">
        <thead>
          <tr>
            <th scope="col">{{ t('suporte.ator') }}</th>
            <th scope="col">{{ t('suporte.alvo') }}</th>
            <th scope="col">{{ t('suporte.estabelecimento') }}</th>
            <th scope="col">{{ t('suporte.inicio') }}</th>
            <th scope="col">{{ t('suporte.situacao') }}</th>
            <th scope="col">{{ t('suporte.escritas') }}</th>
            <th scope="col">{{ t('suporte.atosClinicos') }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t('suporte.detalhar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sessoes" :key="s.id">
            <td>{{ s.atorEmail }}</td>
            <td>
              {{ s.alvoLogin
              }}<small v-if="s.modo === 'acesso-total'"> · {{ t('suporte.modoAcessoTotalCurto') }}</small>
            </td>
            <td>{{ s.estabelecimento }}</td>
            <td>{{ hora(s.inicio) }}</td>
            <td>
              {{ s.aberta ? t('suporte.aberta') : t('suporte.encerrada', { motivo: s.encerramento ?? '' }) }}
            </td>
            <td>{{ s.escritas }}</td>
            <td :class="{ suporte__clinico: s.atosClinicos > 0 }">{{ s.atosClinicos }}</td>
            <td>
              <button type="button" :data-testid="`ver-${s.id}`" @click="ver(s)">
                {{ t('suporte.detalhar') }}
              </button>
              <button v-if="s.aberta" type="button" :data-testid="`encerrar-${s.id}`" @click="encerrar(s)">
                {{ t('suporte.encerrarSessao') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="detalhe" class="suporte__detalhe" data-testid="detalhe-sessao">
        <h2>{{ t('suporte.escritasDaSessao', { id: detalhe.sessao.id }) }}</h2>
        <table class="suporte__tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('suporte.quando') }}</th>
              <th scope="col">{{ t('suporte.metodo') }}</th>
              <th scope="col">{{ t('suporte.caminho') }}</th>
              <th scope="col">{{ t('suporte.status') }}</th>
              <th scope="col">{{ t('suporte.imagens') }}</th>
              <th scope="col">
                <span class="sgh-visualmente-oculto">{{ t('suporte.previaEscrita') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in detalhe.acoes" :key="a.id" :class="{ suporte__clinico: a.clinico }">
              <td>{{ hora(a.dataHora) }}</td>
              <td>{{ a.metodo }}</td>
              <td>
                {{ a.caminho }}
                <strong v-if="a.clinico">
                  · {{ t('suporte.clinico', { alvo: detalhe.sessao.alvoLogin }) }}</strong
                >
                <em v-if="a.naoReversivel">
                  · {{ t('suporte.naoReversivel', { motivo: a.naoReversivel }) }}</em
                >
              </td>
              <td>{{ a.status }} {{ a.http ?? '' }}</td>
              <td>
                {{ a.imagens }} <small v-if="a.corrigida">· {{ t('suporte.corrigida') }}</small>
              </td>
              <td>
                <button v-if="a.imagens > 0 && !a.corrigida" type="button" @click="pedirPrevia(a.id)">
                  {{ t('suporte.previaEscrita') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" data-testid="previa-sessao" @click="pedirPrevia()">
          {{ t('suporte.previaSessao') }}
        </button>

        <div v-if="previa" class="suporte__previa" data-testid="previa">
          <h3>{{ t('suporte.previaTitulo') }}</h3>
          <p v-if="previa.passos.length === 0">{{ t('suporte.previaVazia') }}</p>
          <ul>
            <li v-for="p in previa.passos" :key="p.imagem">
              {{
                t('suporte.compensacao', {
                  tabela: p.tabela,
                  chave: JSON.stringify(p.chave),
                  compensacao: p.compensacao,
                })
              }}
              <ul>
                <li v-for="m in p.mudancas" :key="m.coluna">
                  {{ m.coluna }}: {{ m.atual ?? '—' }} {{ '→' }} {{ m.corrigido ?? '—' }}
                </li>
                <li v-for="c in p.conflito" :key="`c-${c.coluna}`" class="suporte__conflito">
                  {{
                    t('suporte.conflito', {
                      coluna: c.coluna,
                      esperado: c.esperado ?? '—',
                      atual: c.atual ?? '—',
                    })
                  }}
                </li>
              </ul>
            </li>
          </ul>
          <ul v-if="previa.naoReversiveis.length">
            <li v-for="n in previa.naoReversiveis" :key="n.acao">{{ n.acao }}: {{ n.motivo }}</li>
          </ul>
          <ul class="suporte__avisos">
            <li v-for="a in previa.avisos" :key="a">{{ a }}</li>
          </ul>
          <label v-if="previa.exigeConfirmacao">
            <input v-model="confirmarConflito" type="checkbox" data-testid="confirmar-conflito" />
            {{ t('suporte.confirmarConflito') }}
          </label>
          <SanteBotao
            v-if="previa.passos.length > 0"
            :rotulo="t('suporte.executar')"
            :desabilitado="previa.exigeConfirmacao && !confirmarConflito"
            data-testid="executar-correcao"
            @click="executar"
          />
        </div>

        <h3>{{ t('suporte.leiturasDaSessao') }}</h3>
        <ul>
          <li v-for="l in detalhe.leituras" :key="l.caminho">{{ l.caminho }} · {{ l.quantidade }}</li>
        </ul>
        <h3>{{ t('suporte.trilhaLegado') }}</h3>
        <table class="suporte__tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('suporte.quando') }}</th>
              <th scope="col">{{ t('suporte.usuario') }}</th>
              <th scope="col">{{ t('suporte.autorReal') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in trilha" :key="l.idTrilhaLegado" :class="{ suporte__clinico: l.ligada }">
              <td>{{ hora(l.dataHora) }}</td>
              <td>{{ l.usuarioLegado }}</td>
              <td>{{ l.autorReal }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else role="tabpanel">
      <table class="suporte__tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('suporte.quando') }}</th>
            <th scope="col">{{ t('suporte.ator') }}</th>
            <th scope="col">{{ t('suporte.evento') }}</th>
            <th scope="col">{{ t('suporte.alvo') }}</th>
            <th scope="col">{{ t('suporte.detalhe') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in eventos" :key="e.id">
            <td>{{ hora(e.dataHora) }}</td>
            <td>{{ e.ator }}</td>
            <td>{{ e.evento }}</td>
            <td>{{ e.contaAlvo ?? '' }}</td>
            <td>{{ e.detalhe ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.suporte__abas {
  display: flex;
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-3);
}
.suporte__abas button,
.suporte button {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
}
.suporte__abas [aria-selected='true'] {
  font-weight: 700;
  text-decoration: underline;
}
.suporte__novo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.suporte__novo label {
  display: flex;
  flex-direction: column;
}
.suporte__tabela {
  border-collapse: collapse;
  width: 100%;
  margin: var(--sgh-espaco-3) 0;
}
.suporte__tabela th,
.suporte__tabela td {
  text-align: left;
  border-bottom: 1px solid var(--sgh-borda-forte);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  vertical-align: top;
}
.suporte__marca {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  margin-right: var(--sgh-espaco-2);
}
.suporte__clinico {
  font-weight: 700;
}
.suporte__conflito {
  color: var(--sgh-alerta);
}
.suporte__convite {
  word-break: break-all;
}
.suporte__avisos {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
</style>
