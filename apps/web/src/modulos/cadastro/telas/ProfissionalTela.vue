<script setup lang="ts">
// Ficha do profissional (M11; D-PROF-39 com o redesenho do dono de 18/11/2026, no visual de Usuários e Acessos):
// cartão de perfil no topo (iniciais, nome, categoria, situação, login), um aviso único do que não pode ser gravado e
// por quê, e o resto em abas: dados (sensíveis mascarados com o olho), registros em conselho (um profissional pode
// ter mais de um), especialidades, lotação por unidade, convênios credenciados, login do sistema e histórico. A
// situação é a chave "Cadastro ativo" (inativar e reativar com o motivo); excluir só o cadastrado por engano, sem
// nenhum vínculo (a recusa diz quantos e quais e oferece inativar), com o motivo e a senha de novo. Dados bancários
// e de repasse não aparecem (regra 11).
// Login único (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): o cartão mostra cada registro no conselho uma
// vez (conselho + número + UF), com as ocupações (CBO) como detalhe e o inativo marcado, e o login do profissional
// (um só; o dado herdado com mais de um mostra todos). No cartão só a situação legível (Ativo/Inativo pela atividade
// dos registros); o código interno da situação (DP-46.1, significado a confirmar) fica na aba Dados.
import { type FichaProfissional, loginsDistintosDoProfissional, tipoDoProblema } from '@sgh/contratos';
import {
  type PedidoGravacao,
  SanteAlerta,
  SanteBotao,
  SanteChave,
  SanteDialogoGravacao,
  SanteIcone,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  excluirProfissional,
  lerEventosProfissional,
  lerProfissional,
  lerVinculosProfissional,
  situacaoProfissional,
} from '../api-cadastro.js';
import ComplementoProfissional from '../componentes/ComplementoProfissional.vue';
import CredenciamentoConvenios from '../componentes/CredenciamentoConvenios.vue';
import EdicaoProfissional from '../componentes/EdicaoProfissional.vue';
import LotacoesProfissional from '../componentes/LotacoesProfissional.vue';
import VinculoLoginProfissional from '../componentes/VinculoLoginProfissional.vue';
import {
  ABAS_PROFISSIONAL,
  type AbaProfissional,
  acaoLigada,
  ativoDaFicha,
  conselhoDoRegistro,
  dataBr,
  destinoDaTecla,
  gruposDeRegistro,
  indisponiveis,
  iniciais,
  mascarar,
  registroReal,
} from '../profissional-tela.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`cadastro.profissionais.tela.${k}`, p ?? {});
const roteador = useRouter();
const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'profissional', props.id]),
  queryFn: () => lerProfissional(Number(props.id)),
});
const p = computed(() => consulta.data.value);
const rotaAtual = useRoute();
// ?aba=<aba> (o atalho "Profissional vinculado" da ficha do usuário pede "login"): a aba inicial.
const abaDaRota = (): AbaProfissional => {
  const q = rotaAtual.query['aba'];
  return typeof q === 'string' && (ABAS_PROFISSIONAL as readonly string[]).includes(q)
    ? (q as AbaProfissional)
    : 'dados';
};
const aba = ref<AbaProfissional>(abaDaRota());
// ?login=X (o mesmo atalho, para um login sem profissional): o combo de login da aba já vem com ele.
const loginDaRota = computed(() => {
  const l = rotaAtual.query['login'];
  return typeof l === 'string' ? l.trim().toUpperCase() : '';
});
const eventos = useQuery({
  queryKey: computed(() => ['cadastro', 'profissional', props.id, 'eventos']),
  queryFn: () => lerEventosProfissional(Number(props.id)),
  enabled: computed(() => aba.value === 'historico'),
});
const cliente = useQueryClient();
async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['cadastro', 'profissional'] });
  await cliente.invalidateQueries({ queryKey: ['cadastro', 'profissionais'] });
}
// O registro no conselho (com o CBO quando o mesmo conselho, número e UF tem mais de uma ocupação).
const grupos = computed(() => gruposDeRegistro(p.value?.registros ?? []));
const registroDe = (id: number) => {
  const r = p.value?.registros.find((x) => x.id === id);
  if (!r) return String(id);
  const varias = grupos.value.some((g) => g.ocupacoes.length > 1 && g.ocupacoes.some((o) => o.id === id));
  return varias && r.cbo ? `${conselhoDoRegistro(r)} · ${r.cbo}` : conselhoDoRegistro(r);
};
const ativo = computed(() => (p.value ? ativoDaFicha(p.value) : false));
const reais = computed(() => p.value?.registros.filter(registroReal) ?? []);
const editar = computed(() => pode('cadastro.profissional.editar') && !!p.value?.dados);
// ADR 0009: credenciar no convênio pede a permissão que a API exige (convenio.credenciamento.editar).
const podeCredenciar = computed(() => pode('convenio.credenciamento.editar'));
// Revisão da D-PROF-39: os controles seguem o que o executor aceita para quem pergunta (`operacoes` da ficha), como o
// aviso único; sem a gravação liberada, o controle não aparece e o aviso diz por quê.
const ligada = (acao: string) => (p.value ? acaoLigada(p.value, acao) : false);
const editarAba = (acao: string) => editar.value && ligada(acao);
const excluir = computed(() => pode('cadastro.profissional.excluir'));
const situacao = computed(() => excluir.value && ligada('acaoSituacao'));
const exclusao = computed(() => excluir.value && ligada('acaoExcluir'));
const avisoUnico = computed(() => (p.value ? indisponiveis(p.value, pode, t) : []));
// O login do profissional (um só; o dado herdado com mais de um mostra todos, e a aba do login avisa).
const loginsDoCartao = computed(() =>
  p.value?.loginsRegistro
    ? loginsDistintosDoProfissional(p.value.loginsRegistro)
    : [...new Set((p.value?.logins ?? []).filter((l) => l.origem === 'papel').map((l) => l.login))],
);

// Abas: setas, Home e End (padrão de abas acessível); a contagem de cada uma.
const botoesAba = ref<HTMLButtonElement[]>([]);
function teclaAba(e: KeyboardEvent, i: number): void {
  const d = destinoDaTecla(e.key, i, ABAS_PROFISSIONAL.length);
  if (d < 0) return;
  e.preventDefault();
  aba.value = ABAS_PROFISSIONAL[d]!;
  void nextTick(() => botoesAba.value[d]?.focus());
}
const contagem = computed<Partial<Record<AbaProfissional, number>>>(() => ({
  registros: reais.value.length,
  especialidades: p.value?.especialidades.length ?? 0,
  convenios: p.value?.credenciamentos.length ?? 0,
}));

// Sensíveis mascarados com o olho (só na tela; a ficha só chega a quem pode ler).
const revelar = ref(false);
const sensivel = (tipo: 'email' | 'telefone' | 'data' | 'texto', v: string | null | undefined) =>
  revelar.value ? (tipo === 'data' ? dataBr(v) : (v ?? '')) : mascarar(tipo, v);

// Situação (chave), exclusão e o resultado da última ação.
const aviso = ref('');
const recusa = ref('');
const comVinculos = ref(false);
const erro = ref<unknown>(null);
const dialogo = ref(false);
const pedido = ref<PedidoGravacao | null>(null);
const ok = ref('');
const excluindo = ref(false);
const conferindo = ref(false);
function limpar(): void {
  aviso.value = '';
  recusa.value = '';
  comVinculos.value = false;
  erro.value = null;
}
watch(
  () => props.id,
  () => {
    revelar.value = false;
    aba.value = 'dados';
    limpar();
  },
);
function alternarSituacao(ligar: boolean): void {
  limpar();
  const f = p.value;
  if (!f) return;
  excluindo.value = false;
  ok.value = ligar ? T('reativado') : T('inativado');
  pedido.value = {
    titulo: ligar ? T('reativarTitulo', { nome: f.nome }) : T('inativarTitulo', { nome: f.nome }),
    texto: ligar ? T('reativarTexto') : T('inativarTexto'),
    motivo: T('motivo'),
    senha: false,
    confirmar: ligar ? T('reativar') : T('inativar'),
    gravar: ({ motivo }) => situacaoProfissional(f.id, ligar ? 'reativar' : 'inativar', motivo),
  };
  dialogo.value = true;
}
async function pedirExclusao(): Promise<void> {
  limpar();
  const f = p.value;
  if (!f || conferindo.value) return;
  conferindo.value = true;
  try {
    const v = await lerVinculosProfissional(f.id);
    if (!v.podeExcluir) {
      comVinculos.value = true;
      recusa.value = T('comVinculos', {
        n: v.total,
        lista: v.vinculos.map((x) => `${x.grupo}: ${x.quantidade}`).join('; '),
      });
      return;
    }
  } catch (e) {
    erro.value = e;
    return;
  } finally {
    conferindo.value = false;
  }
  excluindo.value = true;
  pedido.value = {
    titulo: T('excluirTitulo', { nome: f.nome }),
    texto: T('excluirTexto'),
    motivo: T('motivoExclusao'),
    senha: true,
    confirmar: T('excluir'),
    gravar: ({ motivo, senha }) => excluirProfissional(f.id, motivo, senha),
  };
  dialogo.value = true;
}
async function feito(): Promise<void> {
  if (excluindo.value) {
    // O profissional não existe mais: a ficha sai do cache sem ser relida (nada de 404 nem erro de relance) e a
    // tela vai para a lista, que é relida.
    cliente.removeQueries({ queryKey: ['cadastro', 'profissional', props.id] });
    await roteador.push({ path: '/cadastros/profissionais', query: { excluido: '1' } });
    await cliente.invalidateQueries({ queryKey: ['cadastro', 'profissionais'] });
    return;
  }
  aviso.value = ok.value || T('gravado');
  await recarregar();
}
function falha(e: unknown): void {
  const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
  if (
    (tipo === 'recusa-de-negocio' || tipo === 'conflito-de-versao' || tipo === 'entrada-invalida') &&
    e instanceof ErroApi &&
    e.problema
  ) {
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
    comVinculos.value = excluindo.value;
  } else erro.value = e;
  void nextTick(() =>
    document
      .querySelector('[data-ficha-resultado]')
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
  );
}
const rotuloEvento = (e: string) => T(`eventos.${e}`);
type Registro = FichaProfissional['registros'][number];
const textoRegistro = (r: Registro) => [r.cbo, r.cboDescricao].filter(Boolean).join(' · ');
</script>

<template>
  <section class="tela ficha-prof" aria-labelledby="profissional-titulo" data-testid="tela-profissional">
    <nav class="trilha" :aria-label="T('navegacao')">
      <RouterLink to="/cadastros/profissionais" class="trilha__voltar">
        <SanteIcone nome="seta" tamanho="1em" class="trilha__seta" />{{ t('cadastro.voltar') }}
      </RouterLink>
    </nav>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!p" role="status">{{ t('cadastro.carregando') }}</p>
    <template v-else>
      <!-- Cartão de perfil -->
      <header class="perfil" data-testid="perfil-profissional">
        <span class="perfil__avatar" aria-hidden="true">{{ iniciais(p.nomeSocial ?? p.nome) }}</span>
        <div class="perfil__textos">
          <h1 id="profissional-titulo" class="perfil__nome">{{ p.nomeSocial ?? p.nome }}</h1>
          <p v-if="p.nomeSocial" class="perfil__sub">{{ p.nome }}</p>
          <div class="pilulas" data-testid="perfil-situacao">
            <span :class="['pilula', ativo ? 'pilula--ok' : 'pilula--neutra']">{{
              ativo ? T('ativo') : T('inativo')
            }}</span>
            <span class="etiqueta etiqueta--texto">{{
              t(`cadastro.profissionais.categorias.${p.categoria}`)
            }}</span>
            <span
              v-for="l in loginsDoCartao"
              :key="l"
              :class="['pilula', loginsDoCartao.length > 1 ? 'pilula--aviso' : 'pilula--ok']"
              data-testid="perfil-login"
            >
              <SanteIcone nome="pessoa" tamanho="0.95em" />{{ l }}
            </span>
            <!-- Revisão (WCAG 1.4.1): o conflito de logins herdados também por escrito, não só pela cor das pílulas. -->
            <span
              v-if="loginsDoCartao.length > 1"
              class="pilula pilula--aviso"
              role="status"
              data-testid="perfil-login-conflito"
              ><SanteIcone nome="alerta" tamanho="0.95em" />{{
                T('loginConflitoCartao', { n: loginsDoCartao.length })
              }}</span
            >
            <span
              v-if="loginsDoCartao.length === 0"
              class="pilula pilula--aviso"
              data-testid="perfil-sem-login"
              >{{ T('semLogin') }}</span
            >
          </div>
          <ul v-if="grupos.length > 0" class="perfil__registros" data-testid="perfil-registros">
            <li v-for="g in grupos" :key="g.chave" data-testid="perfil-registro">
              <span class="etiqueta" data-testid="perfil-conselho">{{ g.rotulo }}</span>
              <span class="perfil__ocupacoes">
                <span
                  v-for="o in g.ocupacoes"
                  :key="o.id"
                  :class="['perfil__ocupacao', { 'perfil__ocupacao--inativa': !o.ativo }]"
                  data-testid="perfil-ocupacao"
                  >{{ o.texto }}<template v-if="!o.ativo"> ({{ T('inativoMarca') }})</template></span
                >
              </span>
            </li>
          </ul>
        </div>
        <div class="perfil__acoes">
          <SanteChave
            v-if="situacao && reais.length > 0"
            :ligada="ativo"
            :rotulo="T('cadastroAtivo')"
            :texto-ligada="T('ativo')"
            :texto-desligada="T('inativo')"
            data-testid="chave-situacao"
            @alternar="alternarSituacao"
          />
          <RouterLink
            v-if="pode('cadastro.historico.ler')"
            class="botao-link"
            :to="`/cadastros/profissionais/${p.id}/historico`"
            >{{ T('alteracoes') }}</RouterLink
          >
          <RouterLink
            class="botao-link"
            data-testid="link-equipes-profissional"
            :to="`/cadastros/profissionais/equipes?profissional=${p.id}`"
            >{{ t('equipesCooperativas.linkDoProfissional') }}</RouterLink
          >
          <SanteBotao
            v-if="exclusao"
            :rotulo="T('excluir')"
            variante="texto"
            :desabilitado="conferindo"
            data-testid="excluir-profissional"
            @acionar="pedirExclusao"
          />
        </div>
      </header>

      <!-- Resultado da última ação -->
      <div v-if="aviso || recusa || erro" class="resultado" data-ficha-resultado>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="ficha-aviso" />
        <div v-if="recusa" class="recusa">
          <SanteAlerta :texto="recusa" variante="aviso" anunciar data-testid="ficha-recusa" />
          <SanteBotao
            v-if="situacao && ativo && comVinculos"
            :rotulo="T('inativarEmVez')"
            variante="secundario"
            data-testid="inativar-em-vez"
            @acionar="alternarSituacao(false)"
          />
        </div>
        <MensagemErro v-if="erro" :erro="erro" />
      </div>

      <!-- Aviso único: o que não pode ser gravado e por quê -->
      <details v-if="avisoUnico.length > 0" class="desligadas" data-testid="aviso-unico">
        <summary>
          <SanteIcone nome="info" tamanho="1.1em" />
          <span>{{ T('indisponiveis', { n: avisoUnico.length }) }}</span>
          <span class="desligadas__ver">{{ T('ver') }}</span>
        </summary>
        <div v-for="(g, i) in avisoUnico" :key="i" class="desligadas__grupo">
          <p class="desligadas__motivo">{{ g.motivo }}</p>
          <p class="desligadas__afeta">
            <span v-for="a in g.acoes" :key="a" class="etiqueta etiqueta--texto">{{ a }}</span>
          </p>
        </div>
      </details>

      <!-- Abas -->
      <div class="abas" role="tablist" :aria-label="T('abasRotulo')">
        <button
          v-for="(a, i) in ABAS_PROFISSIONAL"
          :id="`prof-aba-${a}`"
          :key="a"
          ref="botoesAba"
          type="button"
          role="tab"
          class="aba"
          :aria-selected="aba === a ? 'true' : 'false'"
          :aria-controls="`prof-painel-${a}`"
          :tabindex="aba === a ? 0 : -1"
          :data-testid="`prof-aba-${a}`"
          @click="aba = a"
          @keydown="teclaAba($event, i)"
        >
          {{ T(`abas.${a}`) }}
          <span v-if="contagem[a]" class="aba__n">{{ contagem[a] }}</span>
        </button>
      </div>

      <div
        :id="`prof-painel-${aba}`"
        class="painel"
        role="tabpanel"
        :aria-labelledby="`prof-aba-${aba}`"
        :data-testid="`prof-painel-${aba}`"
      >
        <!-- Dados -->
        <template v-if="aba === 'dados'">
          <section class="cartao" aria-labelledby="prof-identificacao">
            <h2 id="prof-identificacao" class="cartao__titulo">
              {{ T('identificacao') }}
              <button
                v-if="p.dados"
                type="button"
                class="olho"
                :aria-pressed="revelar ? 'true' : 'false'"
                :aria-label="revelar ? T('ocultar') : T('mostrar')"
                :title="revelar ? T('ocultar') : T('mostrar')"
                data-testid="revelar-sensiveis"
                @click="revelar = !revelar"
              >
                <svg
                  width="1.2em"
                  height="1.2em"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  <path v-if="revelar" d="M3 3l18 18" />
                </svg>
              </button>
            </h2>
            <dl class="fatos">
              <div>
                <dt>{{ T('nome') }}</dt>
                <dd>{{ p.nome }}</dd>
              </div>
              <div v-if="p.nomeSocial">
                <dt>{{ T('nomeSocial') }}</dt>
                <dd>{{ p.nomeSocial }}</dd>
              </div>
              <div v-if="p.situacaoLegado.codigo">
                <dt>{{ T('situacaoCadastro') }}</dt>
                <dd data-testid="dado-situacao-cadastro">
                  {{ T('situacaoCodigo', { codigo: p.situacaoLegado.codigo }) }}
                </dd>
              </div>
              <template v-if="p.dados">
                <div>
                  <dt>{{ T('nascimento') }}</dt>
                  <dd class="mono" data-testid="dado-nascimento">
                    {{ sensivel('data', p.dados.nascimento) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ T('nomeMae') }}</dt>
                  <dd data-testid="dado-mae">{{ sensivel('texto', p.dados.nomeMae) }}</dd>
                </div>
                <div>
                  <dt>{{ T('email') }}</dt>
                  <dd class="mono" data-testid="dado-email">{{ sensivel('email', p.dados.email) }}</dd>
                </div>
                <div>
                  <dt>{{ T('celular') }}</dt>
                  <dd class="mono" data-testid="dado-celular">{{ sensivel('telefone', p.dados.celular) }}</dd>
                </div>
              </template>
            </dl>
            <p class="nota">{{ t('cadastro.profissionais.semDadosBancarios') }}</p>
          </section>
          <section v-if="editarAba('acaoDados') && p.dados" class="cartao">
            <EdicaoProfissional :ficha="p" secao="dados" @gravado="recarregar" />
          </section>
          <!-- F3.1 (02-CAD linha 16): RQE, assinatura, dado fiscal e contas do repasse. -->
          <ComplementoProfissional :id-profissional="Number(props.id)" />
        </template>

        <!-- Registros -->
        <section v-if="aba === 'registros'" class="cartao" aria-labelledby="registros-titulo">
          <h2 id="registros-titulo" class="cartao__titulo">{{ t('cadastro.profissionais.registros') }}</h2>
          <table aria-labelledby="registros-titulo" data-testid="registros-profissional">
            <thead>
              <tr>
                <th scope="col">{{ t('cadastro.profissionais.conselho') }}</th>
                <th scope="col">{{ t('cadastro.profissionais.numero') }}</th>
                <th scope="col">{{ t('cadastro.profissionais.uf') }}</th>
                <th scope="col">{{ t('cadastro.profissionais.cbo') }}</th>
                <th scope="col">{{ t('cadastro.profissionais.categoria') }}</th>
                <th scope="col">{{ t('cadastro.profissionais.ativo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in p.registros" :key="r.id" data-testid="registro-profissional">
                <td>{{ r.sigla ?? r.conselho ?? '' }}</td>
                <td>{{ r.numero ?? '' }}</td>
                <td>{{ r.uf ?? '' }}</td>
                <td>{{ textoRegistro(r) }}</td>
                <td>{{ t(`cadastro.profissionais.categorias.${r.categoria}`) }}</td>
                <td>
                  <span
                    v-if="r.ativo !== null"
                    :class="['pilula', r.ativo ? 'pilula--ok' : 'pilula--neutra']"
                    >{{ r.ativo ? T('ativo') : T('inativo') }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
          <EdicaoProfissional
            v-if="editarAba('acaoRegistros')"
            :ficha="p"
            secao="registros"
            @gravado="recarregar"
          />
        </section>

        <!-- Especialidades -->
        <section v-if="aba === 'especialidades'" class="cartao" aria-labelledby="esp-titulo">
          <h2 id="esp-titulo" class="cartao__titulo">{{ t('cadastro.profissionais.especialidades') }}</h2>
          <p v-if="p.especialidades.length === 0">{{ t('cadastro.nenhum') }}</p>
          <ul v-else class="lista">
            <li v-for="e in p.especialidades" :key="`${e.registro}-${e.codigo}`">
              {{ e.nome }} <span class="etiqueta">{{ registroDe(e.registro) }}</span>
              <span v-if="!e.ativo" class="pilula pilula--neutra">{{ T('inativo') }}</span>
            </li>
          </ul>
          <EdicaoProfissional
            v-if="editarAba('acaoEspecialidades')"
            :ficha="p"
            secao="especialidades"
            @gravado="recarregar"
          />
        </section>

        <!-- Lotação -->
        <section v-if="aba === 'lotacao'" class="cartao" aria-labelledby="lot-titulo">
          <h2 id="lot-titulo" class="cartao__titulo">{{ t('cadastro.profissionais.lotacao') }}</h2>
          <!-- F3.1 (02-CAD linha 18): a lotação é só esta (estabelecimento e unidade com CBO, carga semanal, vínculo e
               vigência); a lista e o formulário antigos, por registro e em horas por mês, saíram da aba. -->
          <LotacoesProfissional :profissional="Number(props.id)" />
        </section>

        <!-- Convênios -->
        <section v-if="aba === 'convenios'" class="cartao" aria-labelledby="conv-titulo">
          <h2 id="conv-titulo" class="cartao__titulo">{{ t('cadastro.profissionais.credenciamentos') }}</h2>
          <p v-if="p.credenciamentos.length === 0">{{ t('cadastro.nenhum') }}</p>
          <ul v-else class="lista">
            <li v-for="c in p.credenciamentos" :key="`${c.registro}-${c.convenio}`">
              {{ c.nome ?? c.convenio }} <span class="etiqueta">{{ registroDe(c.registro) }}</span>
            </li>
          </ul>
          <EdicaoProfissional
            v-if="editarAba('acaoConvenios')"
            :ficha="p"
            secao="convenios"
            @gravado="recarregar"
          />
          <!-- ADR 0009: credenciamento por convênio, com plano e vigência (alerta ou bloqueio no atendimento). -->
          <CredenciamentoConvenios :profissional-id="p.id" :pode-editar="podeCredenciar" />
        </section>

        <!-- Login do sistema -->
        <template v-if="aba === 'login'">
          <VinculoLoginProfissional
            v-if="p.loginsRegistro"
            :ficha="p"
            :login-sugerido="loginDaRota"
            @gravado="recarregar"
          />
          <section v-else class="cartao" aria-labelledby="logins-titulo">
            <h2 id="logins-titulo" class="cartao__titulo">{{ t('cadastro.profissionais.logins') }}</h2>
            <p v-if="p.logins.length === 0">{{ t('cadastro.nenhum') }}</p>
            <ul v-else class="lista">
              <li v-for="l in p.logins" :key="`${l.login}-${l.origem}`">
                <span class="etiqueta">{{ l.login }}</span>
              </li>
            </ul>
          </section>
        </template>

        <!-- Histórico do vínculo e da situação -->
        <section v-if="aba === 'historico'" class="cartao" aria-labelledby="hist-titulo">
          <h2 id="hist-titulo" class="cartao__titulo">{{ T('historicoTitulo') }}</h2>
          <MensagemErro v-if="eventos.isError.value" :erro="eventos.error.value" />
          <p v-else-if="eventos.isPending.value" role="status" data-testid="eventos-carregando">
            {{ t('cadastro.carregando') }}
          </p>
          <p v-else-if="(eventos.data.value ?? []).length === 0">{{ T('semEventos') }}</p>
          <ol v-else class="lista" data-testid="eventos-profissional">
            <li v-for="(e, i) in eventos.data.value" :key="i" data-testid="evento-profissional">
              <strong>{{ rotuloEvento(e.evento) }}</strong>
              <span v-if="e.registro" class="etiqueta">{{ registroDe(e.registro) }}</span>
              <span v-if="e.loginAntes || e.loginDepois" class="mono">{{
                T('dePara', { antes: e.loginAntes ?? '—', depois: e.loginDepois ?? '—' })
              }}</span>
              <span class="nota">{{
                T('quem', { usuario: e.usuario, em: e.em.slice(0, 16).replace('T', ' ') })
              }}</span>
              <span v-if="e.motivo" class="motivo">{{ T('motivoEntre', { motivo: e.motivo }) }}</span>
            </li>
          </ol>
          <RouterLink
            v-if="pode('cadastro.historico.ler')"
            class="botao-link"
            :to="`/cadastros/profissionais/${p.id}/historico`"
            >{{ T('alteracoes') }}</RouterLink
          >
        </section>
      </div>

      <SanteDialogoGravacao v-model:visivel="dialogo" :pedido="pedido" @feito="feito" @falha="falha" />
    </template>
  </section>
</template>

<style scoped>
.ficha-prof {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.trilha__voltar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
  color: var(--sgh-link);
  font-size: var(--sgh-fonte-pequena);
}
.trilha__seta {
  transform: scaleX(-1);
}
.perfil {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--sgh-espaco-3);
  align-items: center;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  border-top: 4px solid var(--sgh-primaria);
}
@media (max-width: 40rem) {
  .perfil {
    grid-template-columns: auto 1fr;
  }
  .perfil__acoes {
    grid-column: 1 / -1;
  }
}
.perfil__avatar {
  display: inline-grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  background: var(--sgh-primaria-suave);
  color: var(--sgh-primaria);
  font-weight: 700;
  font-size: 1.4rem;
  font-family: var(--sgh-fonte-titulo);
}
.perfil__textos {
  display: grid;
  gap: var(--sgh-espaco-1);
  min-width: 0;
}
.perfil__nome {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.perfil__sub {
  margin: 0;
  color: var(--sgh-texto-secundario);
}
.perfil__acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
  align-items: center;
}
.resultado,
.recusa {
  display: grid;
  gap: var(--sgh-espaco-2);
  justify-items: start;
  scroll-margin-top: var(--sgh-espaco-4);
}
.resultado {
  justify-items: stretch;
}
.botao-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--p-button-border-radius, 6px);
  color: var(--sgh-texto);
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
  justify-self: start;
}
.perfil__registros {
  display: grid;
  gap: var(--sgh-espaco-1);
  margin: var(--sgh-espaco-1) 0 0;
  padding: 0;
  list-style: none;
}
.perfil__registros li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: baseline;
}
.perfil__ocupacoes {
  color: var(--sgh-texto-secundario);
}
.perfil__ocupacao + .perfil__ocupacao::before {
  content: '; ';
}
.perfil__ocupacao--inativa {
  font-style: italic;
}
.pilulas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.ficha-prof :deep(.pilula) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px var(--sgh-espaco-2);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  border: 1px solid currentcolor;
  white-space: nowrap;
}
.ficha-prof :deep(.pilula--ok) {
  color: var(--sgh-sucesso);
}
.ficha-prof :deep(.pilula--neutra) {
  color: var(--sgh-texto-secundario);
}
.ficha-prof :deep(.pilula--aviso) {
  color: var(--sgh-aviso);
}
.ficha-prof :deep(.etiqueta) {
  display: inline-block;
  padding: 1px var(--sgh-espaco-2);
  border-radius: var(--p-button-border-radius, 6px);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
  font-size: var(--sgh-fonte-pequena);
  font-family: var(--sgh-fonte-codigo);
  white-space: nowrap;
}
.ficha-prof :deep(.etiqueta--texto) {
  font-family: inherit;
}
.desligadas {
  border: 1px solid var(--sgh-aviso);
  background: var(--sgh-aviso-suave);
  border-radius: var(--p-button-border-radius, 6px);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  color: var(--sgh-texto);
}
.desligadas summary {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
  cursor: pointer;
  font-weight: 600;
  flex-wrap: wrap;
  min-height: var(--sgh-alvo-minimo);
}
.desligadas__ver {
  margin-left: auto;
  font-weight: 400;
  text-decoration: underline;
  font-size: var(--sgh-fonte-pequena);
}
.desligadas__grupo {
  margin-top: var(--sgh-espaco-2);
  padding-top: var(--sgh-espaco-2);
  border-top: 1px solid var(--sgh-borda);
}
.desligadas__motivo {
  margin: 0 0 var(--sgh-espaco-1);
}
.desligadas__afeta {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.abas {
  position: relative;
  display: flex;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  overflow-x: auto;
  scrollbar-width: none;
}
.aba {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
}
.aba:hover {
  color: var(--sgh-texto);
}
.aba[aria-selected='true'] {
  color: var(--sgh-texto);
  border-bottom-color: var(--sgh-primaria);
  font-weight: 600;
}
.aba:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: -3px;
}
.aba__n {
  display: inline-grid;
  place-items: center;
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  color: var(--sgh-texto);
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.ficha-prof :deep(.cartao) {
  display: grid;
  gap: var(--sgh-espaco-3);
  align-content: start;
  padding: var(--sgh-espaco-3) var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  min-width: 0;
}
.ficha-prof :deep(.cartao__titulo) {
  margin: 0;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.ficha-prof :deep(.fatos) {
  margin: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.ficha-prof :deep(.fatos > div) {
  display: grid;
  grid-template-columns: minmax(6rem, 11rem) 1fr;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.ficha-prof :deep(.fatos dt) {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.ficha-prof :deep(.fatos dd) {
  margin: 0;
  overflow-wrap: anywhere;
}
.ficha-prof :deep(.nota) {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
  margin: 0;
}
.mono {
  font-family: var(--sgh-fonte-codigo);
}
.olho {
  display: inline-grid;
  place-items: center;
  min-width: var(--sgh-alvo-minimo);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
}
.olho:hover {
  background: var(--sgh-fundo-sutil);
  color: var(--sgh-texto);
}
.olho:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.lista {
  display: grid;
  gap: var(--sgh-espaco-2);
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
.lista li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.motivo {
  font-style: italic;
}
</style>
