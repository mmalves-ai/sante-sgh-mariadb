<script setup lang="ts">
// Tela "Carga e sincronismo" do painel técnico da plataforma (obra carga-painel, ADR 0010): seleção do conector
// Firebird do cliente, configuração da origem de servidor (senha só no cofre, nunca mostrada), carga completa ou
// diferencial, pausa e retomada, progresso ao vivo (tabela atual, barra segmentada gravado/recusado/restante, erros,
// ondas e tabelas) e download do log. A carga roda no serviço do conector: a tela só lê o andamento, buscando ao
// montar e a cada 2 s enquanto a execução está ativa. Só agregados na tela.
import {
  type CargaCliente,
  type ConectorCarga,
  type ModoCarga,
  type TesteOrigem,
  esquemaOrigemServidorEntrada,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  acessoDaCarga,
  cargaAtiva,
  gravarOrigemServidor,
  iniciarCarga,
  lerCarga,
  listarConectores,
  partesEndereco,
  pausarCarga,
  retomarCarga,
  segmentosCarga,
  amostraDe,
  velocidadeConferencia,
  duracaoTexto,
  type AmostraConferencia,
  testarOrigem,
  urlLogCarga,
} from '../api-carga.js';

const { t } = useI18n();
const roteador = useRouter();
const conectores = ref<ConectorCarga[] | null>(null);
const selecionado = ref<string>('');
const carga = ref<CargaCliente | null>(null);
const erro = ref<string | null>(null);
/** Falha da leitura periódica do andamento: some sozinha quando uma leitura volta a dar certo. */
const erroLeitura = ref<string | null>(null);
const alerta = computed(() => erro.value ?? erroLeitura.value);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const modo = ref<ModoCarga>('completa');
const configurando = ref(false);
const teste = ref<TesteOrigem | null>(null);
const form = ref({ nomeExibicao: '', host: '', porta: 3050, banco: '', usuario: '', senha: '' });
let relogio: ReturnType<typeof setInterval> | null = null;
let sequencia = 0;

const statusDe = (e: unknown) => (e instanceof ErroApi ? e.status : 0);
/** A API da carga só atende a sessão da plataforma: 401/403 vira o aviso claro, nunca o erro cru. */
const mensagem = (e: unknown) =>
  [401, 403].includes(statusDe(e)) ? t('carga.soPlataforma') : e instanceof Error ? e.message : String(e);
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR');

const conector = computed(() => conectores.value?.find((c) => c.codigo === selecionado.value) ?? null);
const opcoesConector = computed(() =>
  (conectores.value ?? []).map((c) => ({
    valor: c.codigo,
    rotulo: `${c.origem?.nomeExibicao || c.nome} (${c.codigo})`,
  })),
);
const opcoesModo = computed(() =>
  (['completa', 'diferencial'] as const).map((m) => ({ valor: m, rotulo: t(`carga.acoes.modos.${m}`) })),
);
const execucao = computed(() => carga.value?.execucao ?? null);
const progresso = computed(() => carga.value?.progresso ?? null);
const ativa = computed(() => cargaAtiva(execucao.value?.estado));
const seg = computed(() => segmentosCarga(progresso.value, execucao.value?.percentual ?? 0));
const acoes = computed(() => carga.value?.acoes ?? { iniciar: false, pausar: false, retomar: false });
const senhaDefinida = computed(() => conector.value?.origem?.senhaDefinida === true);
const base = computed(() => (seg.value.daBase ? (progresso.value?.base ?? null) : null));
const contando = computed(() =>
  progresso.value?.etapa === 'contagem' && !(progresso.value?.linhasTotal ?? 0) ? progresso.value : null,
);
// velocidade da conferência: diferença entre dois batimentos distintos (o motor grava a cada ≤ 15 s)
const amostraAnterior = ref<AmostraConferencia | null>(null);
const amostraAtual = ref<AmostraConferencia | null>(null);
watch(progresso, (p) => {
  const a = amostraDe(p);
  if (!a) return;
  if (amostraAtual.value && a.em === amostraAtual.value.em) return;
  if (amostraAtual.value && a.linhas < amostraAtual.value.linhas) amostraAnterior.value = null;
  else amostraAnterior.value = amostraAtual.value;
  amostraAtual.value = a;
});
// velocidade: a do motor (média de 1 min e previsão do fim) quando vem no progresso; senão, entre dois batimentos
const velocidade = computed(() => {
  if (!ativa.value) return null;
  const p = progresso.value;
  if (p?.linhasPorSegundo !== null && p?.linhasPorSegundo !== undefined) {
    const fim = p.previsaoFim ? Date.parse(p.previsaoFim) : Number.NaN;
    return {
      linhasPorSegundo: Math.round(p.linhasPorSegundo),
      segundosRestantes: Number.isFinite(fim) ? Math.max(0, Math.round((fim - Date.now()) / 1000)) : null,
    };
  }
  return velocidadeConferencia(amostraAnterior.value, amostraAtual.value, p?.linhasTotal ?? 0);
});
const percentualConferencia = computed(() => {
  const p = progresso.value;
  return p && p.linhasTotal > 0 ? Math.floor(Math.min(100, (100 * p.linhasProcessadas) / p.linhasTotal)) : 0;
});
const textoBarra = computed(() =>
  seg.value.daBase
    ? t('carga.progresso.baseBarraTexto', {
        percentual: seg.value.percentual,
        naBase: n(seg.value.linhasGravadas),
        recusadas: n(seg.value.linhasRecusadas),
        faltam: n(seg.value.linhasRestantes),
      })
    : t('carga.progresso.barraTexto', {
        percentual: seg.value.percentual,
        gravadas: n(seg.value.linhasGravadas),
        recusadas: n(seg.value.linhasRecusadas),
        restante: n(seg.value.linhasRestantes),
      }),
);
const recusasPorTabela = computed(() =>
  [...(progresso.value?.recusasPorTabela ?? [])]
    .filter((r) => r.recusadas > 0)
    .sort((a, b) => b.recusadas - a.recusadas),
);

function parar(): void {
  if (relogio) clearInterval(relogio);
  relogio = null;
}

async function carregarConectores(): Promise<void> {
  try {
    conectores.value = (await listarConectores()).conectores;
    erro.value = null;
    if (!conector.value && conectores.value.length) {
      const comAtiva = conectores.value.find((c) => cargaAtiva(c.ultimaExecucao?.estado));
      selecionado.value = (comAtiva ?? conectores.value[0]!).codigo;
    }
  } catch (e) {
    erro.value = mensagem(e);
  }
}

/** Lê o andamento do conector escolhido; com a execução ativa, segue lendo a cada 2 s. */
async function acompanhar(codigo: string): Promise<void> {
  parar();
  const minha = ++sequencia;
  const passo = async () => {
    try {
      const c = await lerCarga(codigo);
      if (minha !== sequencia) return;
      const estavaAtiva = cargaAtiva(carga.value?.execucao?.estado);
      carga.value = c;
      erroLeitura.value = null;
      if (!cargaAtiva(c.execucao?.estado)) {
        parar();
        if (estavaAtiva) await carregarConectores();
      } else if (!relogio) {
        relogio = setInterval(passo, 2000);
      }
    } catch (e) {
      if (minha !== sequencia) return;
      erroLeitura.value = mensagem(e);
      // Falha passageira (rede, 502/503 num reinício da API): a carga segue no serviço, então a tela continua
      // lendo enquanto a última execução conhecida estava ativa. Só para de vez sem acesso ou sem o cliente.
      if ([401, 403, 404].includes(statusDe(e)) || !cargaAtiva(carga.value?.execucao?.estado)) parar();
      else if (!relogio) relogio = setInterval(passo, 2000);
    }
  };
  await passo();
}

function preencherForm(c: ConectorCarga | null): void {
  const o = c?.origem;
  const partes = o?.tipo === 'firebird_servidor' ? partesEndereco(o.endereco) : null;
  form.value = {
    nomeExibicao: o?.nomeExibicao ?? c?.nome ?? '',
    host: partes?.host ?? '',
    porta: partes?.porta ?? 3050,
    banco: partes?.banco ?? '',
    usuario: form.value.usuario,
    senha: '',
  };
  teste.value = null;
}

watch(selecionado, async (cod) => {
  carga.value = null;
  aviso.value = null;
  erroLeitura.value = null;
  configurando.value = false;
  preencherForm(conector.value);
  if (cod) await acompanhar(cod);
});

async function agir(acao: () => Promise<unknown>, texto: string): Promise<void> {
  const cod = selecionado.value;
  if (!cod) return;
  ocupado.value = true;
  try {
    await acao();
    erro.value = null;
    aviso.value = texto;
    await acompanhar(cod);
    await carregarConectores();
  } catch (e) {
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

const iniciar = () => agir(() => iniciarCarga(selecionado.value, modo.value), '');
const pausar = () => agir(() => pausarCarga(selecionado.value), t('carga.acoes.pausaPedida'));
const retomar = () => agir(() => retomarCarga(selecionado.value), t('carga.acoes.retomada'));

async function gravarOrigem(): Promise<void> {
  const cod = selecionado.value;
  const f = form.value;
  const r = esquemaOrigemServidorEntrada.safeParse({
    host: f.host,
    porta: Number(f.porta),
    banco: f.banco,
    usuario: f.usuario,
    nomeExibicao: f.nomeExibicao,
    ...(f.senha ? { senha: f.senha } : {}),
  });
  if (!r.success) {
    erro.value = t('carga.configurar.invalido', {
      campos: [...new Set(r.error.issues.map((i) => t(`carga.configurar.${String(i.path[0])}`)))].join(', '),
    });
    return;
  }
  if (!r.data.senha && !senhaDefinida.value) {
    erro.value = t('carga.configurar.senhaNova');
    return;
  }
  ocupado.value = true;
  try {
    await gravarOrigemServidor(cod, r.data);
    form.value.senha = '';
    erro.value = null;
    aviso.value = t('carga.configurar.gravada');
    await carregarConectores();
  } catch (e) {
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

async function testar(): Promise<void> {
  ocupado.value = true;
  teste.value = null;
  aviso.value = t('carga.configurar.testando');
  try {
    teste.value = await testarOrigem(selecionado.value);
    aviso.value = null;
  } catch (e) {
    aviso.value = null;
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

// Rota pública (como as da conta da plataforma): a tela confere a sessão. Conta da plataforma com papel plataforma
// ou administrador carregam; outra sessão vê o aviso; sem nenhuma, vai ao login.
onMounted(async () => {
  const acesso = await acessoDaCarga();
  if (acesso === 'sem-sessao') {
    await roteador.replace('/plataforma/entrar');
    return;
  }
  if (acesso === 'sem-permissao') {
    erro.value = t('carga.soPlataforma');
    return;
  }
  await carregarConectores();
});
onBeforeUnmount(() => {
  sequencia++;
  parar();
});
</script>

<template>
  <section class="carga" aria-labelledby="carga-titulo" data-testid="tela-carga">
    <h1 id="carga-titulo">{{ t('carga.titulo') }}</h1>
    <p>{{ t('carga.texto') }}</p>
    <SanteAlerta v-if="alerta" :texto="alerta" variante="alerta" anunciar data-testid="carga-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="carga-aviso" />

    <p v-if="conectores === null && !alerta" role="status">{{ t('carga.carregando') }}</p>
    <p v-else-if="conectores && !conectores.length" data-testid="carga-sem-conectores">
      {{ t('carga.semConectores') }}
    </p>
    <div v-else-if="conectores" class="carga__linha">
      <SanteSelecao
        v-model="selecionado"
        :rotulo="t('carga.conector')"
        :opcoes="opcoesConector"
        data-testid="carga-conector"
      />
      <SanteBotao variante="texto" :rotulo="t('carga.atualizar')" @acionar="carregarConectores" />
    </div>

    <section v-if="conector" class="carga__bloco" aria-labelledby="carga-origem" data-testid="carga-origem">
      <h2 id="carga-origem">{{ t('carga.origem.titulo') }}</h2>
      <dl class="carga__dados">
        <dt>{{ t('carga.origem.tipo') }}</dt>
        <dd data-testid="carga-origem-tipo">
          {{ conector.origem ? t(`carga.origem.tipos.${conector.origem.tipo}`) : t('carga.semOrigem') }}
        </dd>
        <template v-if="conector.origem">
          <dt>{{ t('carga.origem.endereco') }}</dt>
          <dd data-testid="carga-origem-endereco">{{ conector.origem.endereco }}</dd>
          <template v-if="conector.origem.tipo === 'firebird_servidor'">
            <dt>{{ t('carga.origem.senha') }}</dt>
            <dd data-testid="carga-origem-senha">
              {{ senhaDefinida ? t('carga.origem.senhaDefinida') : t('carga.origem.senhaAusente') }}
            </dd>
          </template>
        </template>
        <dt>{{ t('carga.origem.ultima') }}</dt>
        <dd>
          <template v-if="conector.ultimaExecucao">
            {{ conector.ultimaExecucao.id }}: {{ t(`carga.estados.${conector.ultimaExecucao.estado}`) }}
          </template>
          <template v-else>{{ t('carga.origem.nenhuma') }}</template>
        </dd>
      </dl>
      <SanteBotao
        variante="secundario"
        :rotulo="configurando ? t('carga.configurar.fechar') : t('carga.configurar.abrir')"
        data-testid="carga-configurar"
        @acionar="configurando = !configurando"
      />

      <form
        v-if="configurando"
        class="carga__form"
        aria-labelledby="carga-config-titulo"
        data-testid="carga-form-origem"
        @submit.prevent="gravarOrigem"
      >
        <h3 id="carga-config-titulo">{{ t('carga.configurar.titulo') }}</h3>
        <p class="carga__secundario">{{ t('carga.configurar.texto') }}</p>
        <SanteCampoTexto
          v-model="form.nomeExibicao"
          :rotulo="t('carga.configurar.nomeExibicao')"
          :max-bytes="120"
          obrigatorio
          id="carga-nome"
        />
        <SanteCampoTexto
          v-model="form.host"
          :rotulo="t('carga.configurar.host')"
          :max-bytes="255"
          obrigatorio
          id="carga-host"
        />
        <label for="carga-porta" class="carga__rotulo">{{ t('carga.configurar.porta') }}</label>
        <input
          id="carga-porta"
          v-model.number="form.porta"
          class="carga__entrada"
          type="number"
          min="1"
          max="65535"
          required
          data-testid="carga-porta"
        />
        <SanteCampoTexto
          v-model="form.banco"
          :rotulo="t('carga.configurar.banco')"
          :max-bytes="500"
          obrigatorio
          id="carga-banco"
        />
        <SanteCampoTexto
          v-model="form.usuario"
          :rotulo="t('carga.configurar.usuario')"
          :max-bytes="63"
          obrigatorio
          id="carga-usuario"
        />
        <label for="carga-senha" class="carga__rotulo">{{ t('carga.configurar.senha') }}</label>
        <input
          id="carga-senha"
          v-model="form.senha"
          class="carga__entrada"
          type="password"
          autocomplete="new-password"
          maxlength="200"
          aria-describedby="carga-senha-ajuda"
          data-testid="carga-senha"
        />
        <p id="carga-senha-ajuda" class="carga__secundario" data-testid="carga-senha-ajuda">
          {{ senhaDefinida ? t('carga.configurar.senhaManter') : t('carga.configurar.senhaNova') }}
        </p>
        <div class="carga__linha">
          <SanteBotao
            :rotulo="t('carga.configurar.gravar')"
            :desabilitado="ocupado"
            data-testid="carga-gravar-origem"
            @acionar="gravarOrigem"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('carga.configurar.testar')"
            :desabilitado="ocupado || conector.origem?.tipo !== 'firebird_servidor'"
            data-testid="carga-testar"
            @acionar="testar"
          />
        </div>
        <SanteAlerta
          v-if="teste"
          :variante="teste.ok ? 'info' : 'alerta'"
          anunciar
          data-testid="carga-teste"
          :texto="
            teste.ok
              ? t('carga.configurar.testeOk', {
                  versao: teste.versaoServidor ?? '—',
                  ods: teste.ods ?? '—',
                  tabelas: n(teste.tabelas),
                })
              : t('carga.configurar.testeFalhou', { mensagem: teste.mensagem })
          "
        />
      </form>

      <div class="carga__linha carga__acoes">
        <SanteSelecao
          v-model="modo"
          :rotulo="t('carga.acoes.modo')"
          :opcoes="opcoesModo"
          data-testid="carga-modo"
        />
        <SanteBotao
          variante="destrutivo"
          :rotulo="t('carga.acoes.iniciar')"
          :desabilitado="ocupado || !acoes.iniciar || !conector.origem"
          :confirmacao="
            t('carga.acoes.confirmaIniciar', {
              modo: t(`carga.acoes.modos.${modo}`).toLowerCase(),
              codigo: conector.codigo,
            })
          "
          data-testid="carga-iniciar"
          @acionar="iniciar"
        />
        <SanteBotao
          variante="destrutivo"
          :rotulo="t('carga.acoes.pausar')"
          :desabilitado="ocupado || !acoes.pausar"
          :confirmacao="t('carga.acoes.confirmaPausar', { codigo: conector.codigo })"
          data-testid="carga-pausar"
          @acionar="pausar"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('carga.acoes.retomar')"
          :desabilitado="ocupado || !acoes.retomar"
          data-testid="carga-retomar"
          @acionar="retomar"
        />
        <a
          v-if="execucao?.temLog"
          class="carga__link"
          :href="urlLogCarga(conector.codigo, execucao.id)"
          download
          data-testid="carga-log"
          >{{ t('carga.acoes.baixarLog', { id: execucao.id }) }}</a
        >
      </div>
      <p class="carga__secundario">{{ t(`carga.acoes.ajudaModo.${modo}`) }}</p>
    </section>

    <section
      v-if="conector && execucao"
      class="carga__bloco"
      aria-labelledby="carga-progresso"
      data-testid="carga-progresso"
    >
      <h2 id="carga-progresso">{{ t('carga.progresso.titulo') }}</h2>
      <p>
        {{
          t('carga.progresso.execucao', {
            id: execucao.id,
            tipo: t(`carga.tipos.${execucao.tipo}`),
            modo: execucao.modo ? t(`carga.acoes.modos.${execucao.modo}`) : t('carga.progresso.semModo'),
          })
        }}
        ·
        <span class="carga__estado" :data-estado="execucao.estado" data-testid="carga-estado">{{
          t(`carga.estados.${execucao.estado}`)
        }}</span>
      </p>
      <p v-if="execucao.etapa" class="carga__secundario">
        {{ t('carga.progresso.etapa', { etapa: execucao.etapa }) }}
      </p>

      <SanteAlerta
        v-if="carga?.batimentoAtrasado"
        variante="alerta"
        anunciar
        :texto="t('carga.progresso.batimentoAtrasado')"
        data-testid="carga-batimento"
      />
      <SanteAlerta
        v-if="execucao.estado === 'falhou'"
        variante="alerta"
        :texto="t('carga.progresso.falhou', { motivo: execucao.motivoFalha ?? '' })"
        data-testid="carga-falhou"
      />
      <SanteAlerta
        v-if="execucao.estado === 'pausada'"
        variante="aviso"
        :texto="t('carga.progresso.pausada')"
        data-testid="carga-pausada"
      />

      <div v-if="contando" class="carga__atual" data-testid="carga-contando">
        <span class="carga__rotulo">{{ t('carga.progresso.contandoTitulo') }}</span>
        <p :class="['carga__tabela', { 'carga__tabela--ativa': ativa }]">
          <span class="carga__pulso" aria-hidden="true" />
          <strong v-if="contando.tabelaContando">{{
            t('carga.progresso.contandoTabela', { tabela: contando.tabelaContando })
          }}</strong>
          <span class="carga__secundario">
            {{
              t('carga.progresso.contandoN', {
                feitas: n(contando.tabelasContadas),
                total: n(contando.tabelasTotal),
              })
            }}
          </span>
        </p>
      </div>

      <div v-else class="carga__atual">
        <span class="carga__rotulo">{{ t('carga.progresso.tabelaAtual') }}</span>
        <p
          v-if="progresso?.tabelaAtual"
          :class="['carga__tabela', { 'carga__tabela--ativa': ativa }]"
          data-testid="carga-tabela-atual"
        >
          <span class="carga__pulso" aria-hidden="true" />
          <strong>{{ progresso.tabelaAtual }}</strong>
          <span v-if="progresso.tabelaOrigemLinhas" class="carga__secundario">
            {{
              t('carga.progresso.tabelaLinhas', {
                processadas: n(progresso.tabelaProcessadas),
                total: n(progresso.tabelaOrigemLinhas),
              })
            }}
          </span>
        </p>
        <p v-else class="carga__secundario">{{ t('carga.progresso.nenhumaTabela') }}</p>
      </div>

      <template v-if="base">
        <span class="carga__rotulo">{{ t('carga.progresso.baseTitulo') }}</span>
        <p data-testid="carga-base">
          <strong>{{
            t('carga.progresso.baseTexto', {
              naBase: n(base.linhasNaBase),
              origem: n(base.linhasOrigem),
              percentual: seg.percentual,
            })
          }}</strong>
        </p>
      </template>
      <div class="carga__barra-linha">
        <div
          class="carga__barra"
          role="progressbar"
          :aria-label="seg.daBase ? t('carga.progresso.baseBarra') : t('carga.progresso.barra')"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="seg.percentual"
          :aria-valuetext="textoBarra"
          data-testid="carga-barra"
        >
          <span
            class="carga__seg carga__seg--gravado"
            :style="{ width: `${seg.gravado}%` }"
            data-testid="seg-gravado"
          />
          <span
            class="carga__seg carga__seg--recusado"
            :style="{ width: `${seg.recusado}%` }"
            data-testid="seg-recusado"
          />
        </div>
        <strong class="carga__percentual" data-testid="carga-percentual">{{ seg.percentual }}%</strong>
      </div>
      <ul class="carga__legenda">
        <li>
          <span class="carga__amostra carga__seg--gravado" aria-hidden="true" />{{
            seg.daBase
              ? t('carga.progresso.baseNa', { n: n(seg.linhasGravadas) })
              : t('carga.progresso.gravado', { n: n(seg.linhasGravadas) })
          }}
        </li>
        <li>
          <span class="carga__amostra carga__seg--recusado" aria-hidden="true" />{{
            seg.daBase
              ? t('carga.progresso.baseRecusadas', { n: n(seg.linhasRecusadas) })
              : t('carga.progresso.recusado', { n: n(seg.linhasRecusadas) })
          }}
        </li>
        <li>
          <span class="carga__amostra carga__amostra--restante" aria-hidden="true" />{{
            seg.daBase
              ? t('carga.progresso.baseFaltam', { n: n(seg.linhasRestantes) })
              : t('carga.progresso.restante', { n: n(seg.linhasRestantes) })
          }}
        </li>
      </ul>

      <p v-if="base?.tabelasSemSituacao" class="carga__secundario" data-testid="carga-base-sem-situacao">
        {{ t('carga.progresso.baseSemSituacao', { n: n(base.tabelasSemSituacao) }) }}
      </p>
      <p
        v-if="base?.tabelasRecusasDesconhecidas"
        class="carga__secundario"
        data-testid="carga-base-recusas-desconhecidas"
      >
        {{ t('carga.progresso.baseRecusasDesconhecidas', { n: n(base.tabelasRecusasDesconhecidas) }) }}
      </p>

      <span v-if="progresso && !contando" class="carga__rotulo">{{
        t('carga.progresso.conferenciaTitulo')
      }}</span>
      <ul v-if="progresso && !contando" class="carga__numeros" data-testid="carga-numeros">
        <li>
          {{
            t('carga.progresso.conferenciaLinhas', {
              processadas: n(progresso.linhasProcessadas),
              total: n(progresso.linhasTotal),
              percentual: percentualConferencia,
            })
          }}
        </li>
        <li data-testid="carga-iguais">
          {{ t('carga.progresso.conferidasIguais', { n: n(progresso.puladasIguais) }) }}
        </li>
        <li data-testid="carga-gravadas">
          {{ t('carga.progresso.gravadasNovas', { n: n(progresso.gravadas) }) }}
        </li>
        <li data-testid="carga-recusadas-exec">
          {{ t('carga.progresso.recusadasExec', { n: n(progresso.recusadas) }) }}
        </li>
        <li>{{ t('carga.progresso.avisosExec', { n: n(progresso.pendenciasAviso) }) }}</li>
        <li v-if="velocidade" data-testid="carga-velocidade">
          {{ t('carga.progresso.velocidade', { n: n(velocidade.linhasPorSegundo) }) }}
        </li>
        <li v-if="velocidade && velocidade.segundosRestantes !== null" data-testid="carga-previsao">
          {{ t('carga.progresso.previsao', { quando: duracaoTexto(velocidade.segundosRestantes) }) }}
        </li>
        <li v-if="progresso.ondas" data-testid="carga-onda">
          {{ t('carga.progresso.onda', { onda: progresso.onda ?? 0, ondas: progresso.ondas }) }}
        </li>
        <li data-testid="carga-tabelas">
          {{
            t('carga.progresso.tabelas', {
              feitas: n(progresso.tabelasFeitas),
              total: n(progresso.tabelasTotal),
            })
          }}
        </li>
      </ul>

      <div class="carga__erros" data-testid="carga-erros">
        <span class="carga__rotulo">{{ t('carga.progresso.erros') }}</span>
        <template v-if="seg.linhasRecusadas">
          <strong class="carga__erros-texto">{{
            t('carga.progresso.errosTexto', {
              n: n(seg.linhasRecusadas),
              percentual: seg.percentualErros.toLocaleString('pt-BR'),
            })
          }}</strong>
          <div
            class="carga__mini"
            role="meter"
            :aria-label="t('carga.progresso.errosBarra')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="seg.percentualErros"
          >
            <span
              class="carga__seg carga__seg--recusado"
              :style="{ width: `${Math.max(seg.percentualErros, 1)}%` }"
            />
          </div>
        </template>
        <span v-else>{{ t('carga.progresso.semErros') }}</span>
      </div>

      <p v-if="carga?.conciliacaoCarga" data-testid="carga-conciliacao">
        {{
          carga.conciliacaoCarga.recusadas > 0 || !carga.conciliacaoCarga.conferido
            ? t('carga.progresso.conciliacaoRecusas', { n: n(carga.conciliacaoCarga.recusadas) })
            : t('carga.progresso.conciliacaoOk')
        }}
      </p>

      <table v-if="recusasPorTabela.length" class="carga__tabela-recusas" data-testid="carga-top-recusas">
        <caption>
          {{
            t('carga.progresso.topRecusas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('carga.progresso.tabela') }}</th>
            <th scope="col">{{ t('carga.progresso.recusadas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in recusasPorTabela" :key="r.tabela">
            <td>{{ r.tabela }}</td>
            <td>{{ n(r.recusadas) }}</td>
          </tr>
        </tbody>
      </table>
      <table v-if="base?.porTabelaTop?.length" class="carga__tabela-recusas" data-testid="carga-top-faltam">
        <caption>
          {{
            t('carga.progresso.baseTop')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('carga.progresso.tabela') }}</th>
            <th scope="col">{{ t('carga.progresso.baseFaltamColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in base.porTabelaTop" :key="r.tabela">
            <td>{{ r.tabela }}</td>
            <td>{{ n(r.faltam) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="progresso?.atualizadoEm" class="carga__secundario">
        {{
          t('carga.progresso.atualizadoEm', {
            quando: new Date(progresso.atualizadoEm).toLocaleString('pt-BR'),
          })
        }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.carga {
  display: grid;
  gap: var(--sgh-espaco-3, 0.75rem);
  max-width: 72rem;
}
.carga__bloco {
  border: 1px solid var(--sgh-borda);
  border-radius: 0.5rem;
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}
.carga__linha {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.carga__dados {
  display: grid;
  gap: 0.25rem 1rem;
  grid-template-columns: max-content 1fr;
  margin: 0;
}
.carga__dados dt {
  color: var(--sgh-texto-secundario);
}
.carga__dados dd {
  margin: 0;
}
.carga__form {
  display: grid;
  gap: 0.5rem;
  max-width: 36rem;
}
.carga__rotulo {
  color: var(--sgh-texto-secundario);
  font-size: 0.875rem;
}
.carga__entrada {
  background: var(--sgh-fundo);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 0.25rem;
  color: var(--sgh-texto);
  font: inherit;
  min-height: var(--sgh-alvo-minimo, 2.75rem);
  padding: 0.25rem 0.5rem;
}
.carga__entrada:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
.carga__secundario {
  color: var(--sgh-texto-secundario);
}
.carga__link {
  color: var(--sgh-link);
}
.carga__estado {
  font-weight: 600;
}
.carga__atual {
  display: grid;
  gap: 0.25rem;
}
.carga__tabela {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
}
.carga__pulso {
  background: var(--sgh-texto-secundario);
  border-radius: 50%;
  display: inline-block;
  height: 0.625rem;
  width: 0.625rem;
}
.carga__tabela--ativa .carga__pulso {
  animation: carga-pulso 1.6s ease-in-out infinite;
  background: var(--sgh-primaria);
}
.carga__tabela--ativa strong {
  animation: carga-brilho 1.6s ease-in-out infinite;
}
@keyframes carga-pulso {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.7);
  }
}
@keyframes carga-brilho {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
@media (prefers-reduced-motion: reduce) {
  .carga__tabela--ativa .carga__pulso,
  .carga__tabela--ativa strong {
    animation: none;
  }
}
.carga__barra-linha {
  align-items: center;
  display: flex;
  gap: 0.75rem;
}
.carga__barra {
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 0.375rem;
  display: flex;
  flex: 1;
  height: 1.25rem;
  overflow: hidden;
}
.carga__seg {
  display: block;
  height: 100%;
  transition: width 0.6s ease;
}
@media (prefers-reduced-motion: reduce) {
  .carga__seg {
    transition: none;
  }
}
.carga__seg--gravado {
  background: var(--sgh-sucesso);
}
.carga__seg--recusado {
  background: var(--sgh-alerta);
}
.carga__percentual {
  font-variant-numeric: tabular-nums;
  min-width: 3.5rem;
  text-align: right;
}
.carga__legenda,
.carga__numeros {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.carga__legenda li {
  align-items: center;
  display: inline-flex;
  gap: 0.375rem;
}
.carga__amostra {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 0.125rem;
  display: inline-block;
  height: 0.75rem;
  width: 0.75rem;
}
.carga__amostra--restante {
  background: var(--sgh-fundo-sutil);
}
.carga__erros {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}
.carga__erros-texto {
  color: var(--sgh-alerta-texto);
}
.carga__mini {
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda);
  border-radius: 0.25rem;
  height: 0.5rem;
  overflow: hidden;
  width: 10rem;
}
.carga__tabela-recusas {
  border-collapse: collapse;
  max-width: 36rem;
  width: 100%;
}
.carga__tabela-recusas caption {
  font-weight: 600;
  text-align: left;
}
.carga__tabela-recusas th,
.carga__tabela-recusas td {
  border-bottom: 1px solid var(--sgh-borda);
  padding: 0.25rem 0.5rem;
  text-align: left;
}
.carga__tabela-recusas td:last-child,
.carga__tabela-recusas th:last-child {
  text-align: right;
}
</style>
