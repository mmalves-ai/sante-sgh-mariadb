<script setup lang="ts">
// Prontuário de acesso restrito (03-PEP L93). Duas visões na mesma tela:
// - sem paciente na rota: a fila da unidade (pedidos pendentes, emergenciais no topo, com atalho para o paciente) e a
//   configuração (quem autoriza, validade, senha do paciente, limite de aberturas);
// - com paciente: tudo do paciente numa página — a restrição, a minha situação (abrir com a contagem, ou pedir com
//   motivo e justificativa validada na hora), os pedidos (aprovar/negar ali mesmo, pela equipe ou pelo paciente com a
//   senha), as autorizações com aberturas feitas e o limite, e a senha do paciente (só "definida", nunca o valor).
// A regra final (alçada, senha, limite, validade) é do servidor; a recusa aparece como veio.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type AcaoRestrito,
  gravarRestrito,
  lerFilaRestrito,
  lerPainelRestrito,
  type PedidoTela,
} from '../api-prontuario-restrito.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => (props.paciente ? Number(props.paciente) : null));
const chave = computed(() => ['pep', 'restrito', id.value ?? 'fila']);
const painel = useQuery({
  queryKey: chave,
  queryFn: () => lerPainelRestrito(id.value!),
  enabled: computed(() => id.value !== null),
  staleTime: 0,
});
const fila = useQuery({
  queryKey: ['pep', 'restrito', 'fila'],
  queryFn: () => lerFilaRestrito(),
  enabled: computed(() => id.value === null),
  staleTime: 0,
});
const p = computed(() => painel.data.value);
const f = computed(() => fila.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const JUSTIFICATIVA_MINIMA = 15;
/** O paciente cujo prontuário restrito acabou de ser aberto pela autorização (leva direto à leitura). */
const abertoPaciente = ref<number | null>(null);

async function gravar(acao: AcaoRestrito, corpo: Record<string, unknown>, depois?: () => void) {
  erro.value = null;
  ok.value = '';
  try {
    const r = await gravarRestrito(acao, corpo);
    ok.value = r.mensagem ?? '';
    // A abertura contada libera a leitura normal do prontuário (com os registros confidenciais) por uma janela.
    abertoPaciente.value = acao === 'abrir' ? Number(corpo['paciente']) : null;
    if (acao === 'abrir')
      ok.value = t('pep.restrito.aberto', {
        n: Number(r['resultado'] && (r['resultado'] as { numero: number }).numero),
      });
    depois?.();
    await cliente.invalidateQueries({ queryKey: ['pep', 'restrito'] });
  } catch (e) {
    erro.value = e;
  }
}

// ---- restringir ----
const restricao = reactive({ modo: 'restrito', categoria: 'caso_sensivel', motivo: '' });
const opcoesModo = computed(() =>
  (['restrito', 'consentido'] as const).map((v) => ({ valor: v, rotulo: t(`pep.restrito.modos.${v}`) })),
);
const opcoesCategoria = computed(() =>
  (['personalidade', 'funcionario', 'caso_sensivel', 'judicial', 'pedido_paciente', 'outro'] as const).map(
    (v) => ({
      valor: v,
      rotulo: t(`pep.restrito.categorias.${v}`),
    }),
  ),
);
const restringir = () =>
  gravar(
    'restricoes',
    { paciente: id.value, ...restricao, motivo: restricao.motivo.trim() },
    () => (restricao.motivo = ''),
  );

// ---- pedir ----
const pedido = reactive({ motivo: '', emergencial: false, justificativa: '' });
const opcoesMotivo = computed(() =>
  (p.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
);
watch(
  () => pedido.motivo,
  (v) => {
    const m = p.value?.motivos.find((x) => String(x.id) === v);
    if (m?.textoPadrao && !pedido.justificativa) pedido.justificativa = m.textoPadrao;
  },
);
const justificativaCurta = computed(
  () =>
    (p.value?.configuracao.exigeMotivo || pedido.emergencial) &&
    pedido.justificativa.trim().length < JUSTIFICATIVA_MINIMA,
);
const pedidoPronto = computed(() => Boolean(pedido.motivo) && !justificativaCurta.value);
const pedir = () =>
  gravar(
    'pedidos',
    {
      paciente: id.value,
      motivo: Number(pedido.motivo),
      tipo: pedido.emergencial ? 'emergencial' : 'regular',
      justificativa: pedido.justificativa.trim(),
    },
    () => Object.assign(pedido, { motivo: '', emergencial: false, justificativa: '' }),
  );

// ---- decidir ----
const passo = reactive<Record<number, { motivo: string; senha: string; pelopaciente: boolean }>>({});
const campos = (x: { id: number }) => (passo[x.id] ??= { motivo: '', senha: '', pelopaciente: false });
const senhaNecessaria = (x: PedidoTela) =>
  campos(x).pelopaciente || Boolean(p.value?.configuracao.exigeSenhaPaciente);
const podeAprovar = (x: PedidoTela) => !senhaNecessaria(x) || /^\d{6,12}$/.test(campos(x).senha);
const decidir = (x: PedidoTela, aprovar: boolean) =>
  gravar(
    'pedidos/decidir',
    {
      pedido: x.id,
      versao: x.versao,
      aprovar,
      motivoDecisao: campos(x).motivo.trim(),
      pelopaciente: campos(x).pelopaciente,
      ...(aprovar && senhaNecessaria(x) ? { senhaPaciente: campos(x).senha } : {}),
    },
    () => (campos(x).senha = ''),
  );
const podeAutorizar = computed(() => pode('pep.prontuarioRestrito.autorizar'));

// ---- senha do paciente ----
const senha = ref('');
const senhaFraca = computed(() => {
  const s = senha.value;
  if (!/^\d{6,12}$/.test(s)) return true;
  if (/^(\d)\1+$/.test(s)) return true;
  const d = [...s].map(Number);
  const passo1 = d[1]! - d[0]!;
  return Math.abs(passo1) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === passo1);
});
const gravarSenha = () =>
  gravar('senha', { paciente: id.value, senha: senha.value }, () => (senha.value = ''));

// ---- configuração ----
const cfg = reactive({
  autorizador: 'medico_responsavel',
  papelId: '',
  validadeHoras: 24,
  exigeSenhaPaciente: false,
  limiteAcessos: '' as string | number,
  exigeMotivo: true,
  avisaResponsavel: true,
});
watch(
  () => f.value?.configuracao,
  (c) => {
    if (!c) return;
    Object.assign(cfg, {
      autorizador: c.autorizador,
      papelId: c.papelId ? String(c.papelId) : '',
      validadeHoras: c.validadeHoras,
      exigeSenhaPaciente: c.exigeSenhaPaciente,
      limiteAcessos: c.limiteAcessos ?? '',
      exigeMotivo: c.exigeMotivo,
      avisaResponsavel: c.avisaResponsavel,
    });
  },
  { immediate: true },
);
const opcoesAutorizador = computed(() =>
  (['medico_responsavel', 'diretoria_clinica', 'papel', 'paciente'] as const).map((v) => ({
    valor: v,
    rotulo: t(`pep.restrito.autorizadores.${v}`),
  })),
);
const opcoesPapel = computed(() =>
  (f.value?.papeis ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
);
const cfgValida = computed(
  () =>
    cfg.validadeHoras >= 1 &&
    cfg.validadeHoras <= 8760 &&
    (cfg.autorizador !== 'papel' || Boolean(cfg.papelId)) &&
    (cfg.autorizador !== 'paciente' || cfg.exigeSenhaPaciente) &&
    (cfg.limiteAcessos === '' || (Number(cfg.limiteAcessos) >= 1 && Number(cfg.limiteAcessos) <= 999)),
);
const gravarCfg = () =>
  gravar('configuracao', {
    autorizador: cfg.autorizador,
    papelId: cfg.autorizador === 'papel' ? Number(cfg.papelId) : null,
    validadeHoras: Number(cfg.validadeHoras),
    exigeSenhaPaciente: cfg.exigeSenhaPaciente,
    limiteAcessos: cfg.limiteAcessos === '' ? null : Number(cfg.limiteAcessos),
    exigeMotivo: cfg.exigeMotivo,
    avisaResponsavel: cfg.avisaResponsavel,
  });
</script>

<template>
  <section class="restrito" data-testid="restrito-tela">
    <h1>{{ id === null ? t('pep.restrito.tituloFila') : t('pep.restrito.titulo') }}</h1>
    <MensagemErro v-if="painel.error.value" :erro="painel.error.value" />
    <MensagemErro v-if="fila.error.value" :erro="fila.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="restrito-ok" />

    <!-- Fila da unidade e configuração -->
    <template v-if="id === null && f">
      <h2>{{ t('pep.restrito.fila') }}</h2>
      <p v-if="f.pedidos.length === 0" data-testid="restrito-fila-vazia">
        {{ t('pep.restrito.nenhumPendente') }}
      </p>
      <ul v-else class="restrito__lista">
        <li v-for="x in f.pedidos" :key="x.id" :data-testid="`restrito-fila-${x.id}`">
          <strong>{{ t('pep.restrito.prontuario', { n: x.prontuario ?? x.paciente }) }}</strong>
          <span v-if="x.tipo === 'emergencial'" class="restrito__emergencial">{{
            t('pep.restrito.emergencial')
          }}</span>
          — {{ x.motivo }} ·
          {{ t('pep.restrito.pedidoPor', { quem: x.solicitante ?? '', quando: dataHoraBr(x.solicitadoEm) }) }}
          <RouterLink :to="`/pep/paciente/${x.paciente}/prontuario-restrito`">{{
            t('pep.restrito.abrirPaciente')
          }}</RouterLink>
        </li>
      </ul>

      <template v-if="pode('pep.prontuarioRestrito.configurar')">
        <h2>{{ t('pep.restrito.configuracao') }}</h2>
        <p v-if="!f.configuracao.daUnidade" class="restrito__meta">{{ t('pep.restrito.padrao') }}</p>
        <form class="restrito__form" data-testid="restrito-configuracao" @submit.prevent="gravarCfg">
          <SanteSelecao
            v-model="cfg.autorizador"
            :rotulo="t('pep.restrito.autorizador')"
            :opcoes="opcoesAutorizador"
            data-testid="restrito-autorizador"
          />
          <SanteSelecao
            v-if="cfg.autorizador === 'papel'"
            v-model="cfg.papelId"
            :rotulo="t('pep.restrito.papel')"
            :opcoes="opcoesPapel"
            data-testid="restrito-papel"
          />
          <label
            >{{ t('pep.restrito.validadeHoras') }}
            <input
              v-model.number="cfg.validadeHoras"
              type="number"
              min="1"
              max="8760"
              data-testid="restrito-validade"
            />
          </label>
          <label
            >{{ t('pep.restrito.limite') }}
            <input
              v-model="cfg.limiteAcessos"
              type="number"
              min="1"
              max="999"
              data-testid="restrito-limite"
            />
          </label>
          <label
            ><input v-model="cfg.exigeSenhaPaciente" type="checkbox" data-testid="restrito-exige-senha" />
            {{ t('pep.restrito.exigeSenha') }}</label
          >
          <label
            ><input v-model="cfg.exigeMotivo" type="checkbox" /> {{ t('pep.restrito.exigeMotivo') }}</label
          >
          <label
            ><input v-model="cfg.avisaResponsavel" type="checkbox" />
            {{ t('pep.restrito.avisaResponsavel') }}</label
          >
          <SanteBotao
            tipo="submit"
            :desabilitado="!cfgValida"
            :rotulo="t('pep.restrito.gravarConfiguracao')"
            data-testid="restrito-gravar-configuracao"
          />
        </form>
      </template>
    </template>

    <!-- Visão por paciente -->
    <template v-if="id !== null && p">
      <p class="restrito__meta">{{ t('pep.restrito.prontuario', { n: p.prontuario ?? p.paciente }) }}</p>
      <template v-if="!p.restricao">
        <p data-testid="restrito-livre">{{ t('pep.restrito.livre') }}</p>
        <form
          v-if="pode('pep.prontuarioRestrito.configurar')"
          class="restrito__form"
          data-testid="restrito-restringir"
          @submit.prevent="restringir"
        >
          <SanteSelecao v-model="restricao.modo" :rotulo="t('pep.restrito.modo')" :opcoes="opcoesModo" />
          <SanteSelecao
            v-model="restricao.categoria"
            :rotulo="t('pep.restrito.categoria')"
            :opcoes="opcoesCategoria"
          />
          <label class="restrito__largo"
            >{{ t('pep.restrito.motivoRestricao') }}
            <input v-model="restricao.motivo" maxlength="500" data-testid="restrito-motivo-restricao" />
          </label>
          <SanteBotao
            tipo="submit"
            :desabilitado="restricao.motivo.trim().length < 5"
            :rotulo="t('pep.restrito.restringir')"
            data-testid="restrito-restringir-enviar"
          />
        </form>
      </template>
      <template v-else>
        <SanteAlerta
          variante="aviso"
          :texto="`${t(`pep.restrito.categorias.${p.restricao.categoria}`)} · ${t(`pep.restrito.modos.${p.restricao.modo}`)} — ${t('pep.restrito.restrito', { quando: dataHoraBr(p.restricao.desde), motivo: p.restricao.motivo })}`"
          data-testid="restrito-marca"
        />
        <SanteBotao
          v-if="pode('pep.prontuarioRestrito.configurar')"
          variante="secundario"
          :rotulo="t('pep.restrito.encerrar')"
          data-testid="restrito-encerrar"
          @click="gravar('restricoes/encerrar', { restricao: p.restricao.id, versao: p.restricao.versao })"
        />

        <!-- Minha situação: abrir pela autorização ou pedir -->
        <p v-if="abertoPaciente === p.paciente">
          <RouterLink :to="`/pep/prontuario/${p.paciente}`" data-testid="restrito-ler-prontuario">{{
            t('pep.restrito.lerProntuario')
          }}</RouterLink>
        </p>
        <div v-if="p.minha.permitido" class="restrito__minha" data-testid="restrito-minha">
          <p>
            {{ t('pep.restrito.minhaLiberada') }}
            {{
              p.minha.restantes === null
                ? t('pep.restrito.semLimite')
                : t('pep.restrito.restantes', { n: p.minha.restantes + 1 })
            }}
          </p>
          <SanteBotao
            :rotulo="t('pep.restrito.abrir')"
            data-testid="restrito-abrir"
            @click="gravar('abrir', { paciente: p.paciente })"
          />
        </div>
        <template v-else-if="pode('pep.prontuarioRestrito.pedir')">
          <SanteAlerta v-if="p.minha.mensagem" variante="info" :texto="p.minha.mensagem" />
          <p v-if="p.motivos.length === 0" data-testid="restrito-sem-motivos">
            {{ t('pep.restrito.semMotivos') }}
          </p>
          <form v-else class="restrito__form" data-testid="restrito-pedir" @submit.prevent="pedir">
            <SanteSelecao
              v-model="pedido.motivo"
              :rotulo="t('pep.restrito.motivo')"
              :opcoes="opcoesMotivo"
              data-testid="restrito-motivo"
            />
            <label
              ><input v-model="pedido.emergencial" type="checkbox" data-testid="restrito-emergencial" />
              {{ t('pep.restrito.emergencial') }}</label
            >
            <label class="restrito__largo"
              >{{ t('pep.restrito.justificativa') }}
              <textarea
                v-model="pedido.justificativa"
                rows="3"
                maxlength="2000"
                :aria-invalid="justificativaCurta"
                data-testid="restrito-justificativa"
              />
            </label>
            <SanteAlerta
              v-if="justificativaCurta && pedido.justificativa.length > 0"
              variante="alerta"
              :texto="t('pep.restrito.justificativaCurta', { n: JUSTIFICATIVA_MINIMA })"
            />
            <SanteBotao
              tipo="submit"
              :desabilitado="!pedidoPronto"
              :rotulo="t('pep.restrito.enviar')"
              data-testid="restrito-enviar"
            />
          </form>
        </template>
      </template>

      <h2>{{ t('pep.restrito.pedidos') }}</h2>
      <p v-if="p.pedidos.length === 0">{{ t('pep.restrito.nenhumPedido') }}</p>
      <article
        v-for="x in p.pedidos"
        :key="x.id"
        class="restrito__item"
        :data-testid="`restrito-pedido-${x.id}`"
      >
        <p>
          <strong>{{ t(`pep.restrito.situacoes.${x.situacao}`) }}</strong> — {{ x.motivo }}
          <span v-if="x.tipo === 'emergencial'" class="restrito__emergencial">{{
            t('pep.restrito.emergencial')
          }}</span>
        </p>
        <p class="restrito__corpo">{{ x.justificativa }}</p>
        <p class="restrito__meta">
          {{ t('pep.restrito.pedidoPor', { quem: x.solicitante ?? '', quando: dataHoraBr(x.solicitadoEm) }) }}
        </p>
        <p v-if="x.motivoDecisao" class="restrito__meta">{{ x.motivoDecisao }}</p>
        <SanteBotao
          v-if="x.doUsuario && x.situacao === 'pendente'"
          variante="secundario"
          :rotulo="t('pep.restrito.cancelar')"
          :data-testid="`restrito-cancelar-${x.id}`"
          @click="gravar('pedidos/cancelar', { pedido: x.id, versao: x.versao })"
        />
        <div v-if="podeAutorizar && !x.doUsuario && x.situacao === 'pendente'" class="restrito__form">
          <label
            ><input
              v-model="campos(x).pelopaciente"
              type="checkbox"
              :data-testid="`restrito-pelopaciente-${x.id}`"
            />
            {{ t('pep.restrito.pelopaciente') }}</label
          >
          <label v-if="senhaNecessaria(x)"
            >{{ t('pep.restrito.senhaPaciente') }}
            <input
              v-model="campos(x).senha"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              maxlength="12"
              :data-testid="`restrito-senha-${x.id}`"
            />
          </label>
          <SanteBotao
            v-if="p.podeDecidir || campos(x).pelopaciente"
            :desabilitado="!podeAprovar(x)"
            :rotulo="t('pep.restrito.aprovar')"
            :data-testid="`restrito-aprovar-${x.id}`"
            @click="decidir(x, true)"
          />
          <template v-if="p.podeDecidir && !campos(x).pelopaciente">
            <label
              >{{ t('pep.restrito.motivoNegar') }}
              <input
                v-model="campos(x).motivo"
                maxlength="500"
                :data-testid="`restrito-motivo-negar-${x.id}`"
              />
            </label>
            <SanteBotao
              variante="secundario"
              :desabilitado="campos(x).motivo.trim().length < 5"
              :rotulo="t('pep.restrito.negar')"
              :data-testid="`restrito-negar-${x.id}`"
              @click="decidir(x, false)"
            />
          </template>
        </div>
      </article>

      <h2>{{ t('pep.restrito.autorizacoes') }}</h2>
      <p v-if="p.autorizacoes.length === 0">{{ t('pep.restrito.nenhumaAutorizacao') }}</p>
      <article
        v-for="a in p.autorizacoes"
        :key="a.id"
        class="restrito__item"
        :class="{ 'restrito__item--fora': !a.vigente }"
        :data-testid="`restrito-autorizacao-${a.id}`"
      >
        <p>
          <strong>{{ a.autorizado }}</strong> {{ t(`pep.restrito.concedidaPor.${a.concedidaPor}`) }} ·
          {{
            a.limite === null
              ? t('pep.restrito.acessosSemLimite', { n: a.acessos })
              : t('pep.restrito.acessos', { n: a.acessos, limite: a.limite })
          }}
          <span v-if="a.fim"> · {{ t('pep.restrito.vigenteAte', { quando: dataHoraBr(a.fim) }) }}</span>
        </p>
        <p v-if="a.revogadaEm" class="restrito__meta">
          {{ t('pep.restrito.revogada', { motivo: a.motivoRevogacao ?? '' }) }}
        </p>
        <div v-else-if="podeAutorizar && a.vigente" class="restrito__form">
          <label
            >{{ t('pep.restrito.motivoRevogar') }}
            <input
              v-model="campos(a).motivo"
              maxlength="300"
              :data-testid="`restrito-motivo-revogar-${a.id}`"
            />
          </label>
          <SanteBotao
            variante="secundario"
            :desabilitado="campos(a).motivo.trim().length < 5"
            :rotulo="t('pep.restrito.revogar')"
            :data-testid="`restrito-revogar-${a.id}`"
            @click="
              gravar('autorizacoes/revogar', {
                autorizacao: a.id,
                versao: a.versao,
                motivo: campos(a).motivo.trim(),
              })
            "
          />
        </div>
      </article>

      <template v-if="podeAutorizar">
        <h2>{{ t('pep.restrito.senha') }}</h2>
        <p data-testid="restrito-senha-situacao">
          {{
            p.senha.bloqueada
              ? t('pep.restrito.senhaBloqueada')
              : p.senha.definida
                ? t('pep.restrito.senhaDefinida')
                : t('pep.restrito.semSenha')
          }}
        </p>
        <form class="restrito__form" data-testid="restrito-senha" @submit.prevent="gravarSenha">
          <label
            >{{ t('pep.restrito.novaSenha') }}
            <input
              v-model="senha"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              maxlength="12"
              :aria-invalid="senha.length > 0 && senhaFraca"
              data-testid="restrito-nova-senha"
            />
          </label>
          <SanteAlerta
            v-if="senha.length > 0 && senhaFraca"
            variante="alerta"
            :texto="t('pep.restrito.senhaFraca')"
          />
          <SanteBotao
            tipo="submit"
            :desabilitado="senhaFraca"
            :rotulo="t('pep.restrito.gravarSenha')"
            data-testid="restrito-gravar-senha"
          />
        </form>
      </template>
    </template>
  </section>
</template>

<style scoped>
.restrito {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.restrito__form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.restrito__largo {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.restrito__lista {
  padding-inline-start: var(--sgh-espaco-3);
}
.restrito__emergencial {
  font-weight: 600;
}
.restrito__item {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
.restrito__item--fora {
  color: var(--sgh-texto-secundario);
}
.restrito__corpo {
  white-space: pre-wrap;
}
.restrito__meta {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
</style>
