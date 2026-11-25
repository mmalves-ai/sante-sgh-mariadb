<script setup lang="ts">
// D-PROF-39: edição do profissional na ficha, para quem tem `cadastro.profissional.editar`: dados (com a versão lida;
// a colisão com outro terminal aparece com o motivo), registros (incluir; ativar e inativar; a linha mantida pelo
// próprio cadastro não se edita), especialidades, lotação por unidade e convênios credenciados. Tudo pelo servidor
// (o executor grava). Combos com busca (ADR 0027). Nada bancário nem de repasse (regra 11).
// Redesenho (requisito 3 do dono): a ficha mostra uma seção por aba (`secao`); no registro, quem tem
// `cadastro.profissional.excluir` exclui o incluído por engano (só sem atos: os vínculos são conferidos antes e a
// recusa diz quantos e quais), com o motivo e a senha de novo.
import { type FichaProfissional, tipoDoProblema } from '@sgh/contratos';
import { type PedidoGravacao, SanteAlerta, SanteBotao, SanteDialogoGravacao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { operacaoLigada } from '../profissional-tela.js';
import {
  alterarDadosProfissional,
  excluirRegistroProfissional,
  lerVinculosProfissional,
  alterarRegistroProfissional,
  credenciarProfissional,
  definirEspecialidadeProfissional,
  incluirRegistroProfissional,
  lerOpcoesProfissional,
} from '../api-cadastro.js';

const props = defineProps<{
  ficha: FichaProfissional;
  secao: 'dados' | 'registros' | 'especialidades' | 'convenios';
}>();
const emit = defineEmits<{ gravado: [] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`cadastro.profissionais.edicao.${k}`, p ?? {});
const opcoes = useQuery({
  queryKey: ['cadastro', 'profissionais', 'opcoes'],
  queryFn: () => lerOpcoesProfissional(),
});
const o = computed(() => opcoes.data.value);

const SOMBRA = '000000';
const reais = computed(() => props.ficha.registros.filter((r) => r.cbo !== SOMBRA));
const rotuloRegistro = (r: FichaProfissional['registros'][number]) =>
  `${r.sigla ?? r.conselho ?? ''} ${r.numero ?? ''}/${r.uf ?? ''} · ${r.cbo ?? ''}`;
const registros = computed(() => [
  { valor: null, rotulo: T('escolha') },
  ...reais.value.map((r) => ({ valor: r.id, rotulo: rotuloRegistro(r) })),
]);
const lista = (xs: readonly { valor: number | string; rotulo: string }[] | undefined) => [
  { valor: null, rotulo: T('escolha') },
  ...(xs ?? []).map((x) => ({ valor: Number(x.valor), rotulo: x.rotulo })),
];

const gravando = ref(false);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
async function executar(fn: () => Promise<unknown>): Promise<boolean> {
  if (gravando.value) return false;
  gravando.value = true;
  recusa.value = null;
  erro.value = null;
  feito.value = null;
  try {
    await fn();
    feito.value = T('gravado');
    emit('gravado');
    return true;
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if (
      (tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida' || tipo === 'conflito-de-versao') &&
      e instanceof ErroApi &&
      e.problema
    )
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Dados ──
const editandoDados = ref(false);
const d = ref({
  nome: '',
  nomeSocial: '',
  sexo: '' as '' | 'F' | 'M',
  nascimento: '',
  nomeMae: '',
  email: '',
  celular: '',
});
function abrirDados(): void {
  const x = props.ficha.dados;
  d.value = {
    nome: props.ficha.nome,
    nomeSocial: props.ficha.nomeSocial ?? '',
    sexo: x?.sexo === 'F' || x?.sexo === 'M' ? x.sexo : '',
    nascimento: x?.nascimento ?? '',
    nomeMae: x?.nomeMae ?? '',
    email: x?.email ?? '',
    celular: x?.celular ?? '',
  };
  editandoDados.value = true;
}
const sexos = computed(() => [
  { valor: '' as const, rotulo: T('sexos.vazio') },
  { valor: 'F' as const, rotulo: T('sexos.F') },
  { valor: 'M' as const, rotulo: T('sexos.M') },
]);
async function gravarDados(): Promise<void> {
  const x = props.ficha.dados;
  if (!x) return;
  const a: Record<string, string | null> = {};
  const antes = {
    nome: props.ficha.nome,
    nomeSocial: props.ficha.nomeSocial ?? '',
    sexo: x.sexo ?? '',
    nascimento: x.nascimento ?? '',
    nomeMae: x.nomeMae ?? '',
    email: x.email ?? '',
    celular: x.celular ?? '',
  };
  for (const [k, v] of Object.entries(d.value)) {
    const novo = v.trim();
    if (novo.toUpperCase() === String(antes[k as keyof typeof antes]).toUpperCase()) continue;
    a[k] = novo === '' && k !== 'nome' ? null : novo;
  }
  if (Object.keys(a).length === 0) {
    editandoDados.value = false;
    return;
  }
  if (await executar(() => alterarDadosProfissional(props.ficha.id, x.versao, a)))
    editandoDados.value = false;
}

// ── Registros ──
const nr = ref({ conselho: 'CRM', numero: '', uf: '', cbo: null as number | null, credenciarTodos: true });
const conselhos = computed(() =>
  (o.value?.conselhos ?? []).map((c) => ({ valor: String(c.valor), rotulo: c.rotulo })),
);
const ufs = computed(() => [
  { valor: '', rotulo: T('escolha') },
  ...(o.value?.ufs ?? []).map((u) => ({ valor: u, rotulo: u })),
]);
async function incluirRegistro(): Promise<void> {
  const numero = Number(nr.value.numero.replace(/\D+/g, ''));
  if (!numero || !nr.value.uf || nr.value.cbo === null) {
    recusa.value = T('obrigatorios');
    return;
  }
  const cbo = nr.value.cbo;
  if (
    await executar(() =>
      incluirRegistroProfissional(props.ficha.id, {
        conselho: nr.value.conselho,
        numero,
        uf: nr.value.uf,
        cbo,
        convenios: nr.value.credenciarTodos ? (o.value?.convenios ?? []).map((c) => Number(c.valor)) : [],
      }),
    )
  )
    nr.value = { conselho: 'CRM', numero: '', uf: '', cbo: null, credenciarTodos: true };
}
// Encerrar ou reativar o registro: com o motivo (vai ao histórico do profissional) e só para quem pode inativar e
// reativar (cadastro.profissional.excluir), como no servidor.
const situacaoRegistro = computed(
  () =>
    pode('cadastro.profissional.excluir') &&
    operacaoLigada(props.ficha, 'cadastro.alterarRegistroProfissional'),
);
function alternarRegistro(r: FichaProfissional['registros'][number]): void {
  recusa.value = null;
  erro.value = null;
  feito.value = null;
  const reativar = r.ativo === false;
  pedido.value = {
    titulo: reativar
      ? T('reativarRegistroTitulo', { registro: rotuloRegistro(r) })
      : T('inativarRegistroTitulo', { registro: rotuloRegistro(r) }),
    texto: reativar ? T('reativarRegistroTexto') : T('inativarRegistroTexto'),
    motivo: T('motivoRegistro'),
    senha: false,
    confirmar: reativar ? T('reativar') : T('inativar'),
    gravar: ({ motivo }) =>
      alterarRegistroProfissional(props.ficha.id, r.id, r.versao ?? '', { ativo: reativar }, fetch, motivo),
  };
  dialogo.value = true;
}

// ── Excluir o registro incluído por engano (só sem atos) ──
const dialogo = ref(false);
const pedido = ref<PedidoGravacao | null>(null);
async function excluirRegistro(r: FichaProfissional['registros'][number]): Promise<void> {
  recusa.value = null;
  erro.value = null;
  feito.value = null;
  try {
    const v = await lerVinculosProfissional(props.ficha.id, r.id);
    if (!v.podeExcluir) {
      recusa.value = T('registroComAtos', {
        n: v.total,
        lista: v.vinculos.map((x) => `${x.grupo}: ${x.quantidade}`).join('; '),
      });
      return;
    }
  } catch (e) {
    erro.value = e;
    return;
  }
  pedido.value = {
    titulo: T('excluirRegistroTitulo', { registro: rotuloRegistro(r) }),
    texto: T('excluirRegistroTexto'),
    motivo: T('motivoExclusao'),
    senha: true,
    confirmar: T('excluirRegistro'),
    gravar: ({ motivo, senha }) => excluirRegistroProfissional(props.ficha.id, r.id, motivo, senha),
  };
  dialogo.value = true;
}
function falhaDialogo(e: unknown): void {
  const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
  if ((tipo === 'recusa-de-negocio' || tipo === 'conflito-de-versao') && e instanceof ErroApi && e.problema)
    recusa.value = e.problema.detail ?? e.problema.title ?? '';
  else erro.value = e;
}
function feitoDialogo(): void {
  feito.value = T('gravado');
  emit('gravado');
}

// ── Especialidades ──
const ne = ref({ registro: null as number | null, especialidade: null as number | null });
async function incluirEspecialidade(): Promise<void> {
  const { registro, especialidade } = ne.value;
  if (registro === null || especialidade === null) {
    recusa.value = T('obrigatorios');
    return;
  }
  if (
    await executar(() =>
      definirEspecialidadeProfissional(props.ficha.id, { registro, especialidade, ativo: true }),
    )
  )
    ne.value = { registro: null, especialidade: null };
}
const especialidadesEditaveis = computed(() =>
  props.ficha.especialidades.filter((e) => reais.value.some((r) => r.id === e.registro)),
);

// ── Credenciamento ──
const nc = ref({ registro: null as number | null, convenio: null as number | null });
async function credenciar(): Promise<void> {
  const { registro, convenio } = nc.value;
  if (registro === null || convenio === null) {
    recusa.value = T('obrigatorios');
    return;
  }
  if (await executar(() => credenciarProfissional(props.ficha.id, { registro, convenio, credenciado: true })))
    nc.value = { registro: null, convenio: null };
}
const credenciamentosEditaveis = computed(() =>
  props.ficha.credenciamentos.filter((c) => reais.value.some((r) => r.id === c.registro)),
);
</script>

<template>
  <section class="edicao" aria-labelledby="edicao-profissional-titulo" data-testid="edicao-profissional">
    <h2 id="edicao-profissional-titulo" class="sgh-visualmente-oculto">{{ T('dadosTitulo') }}</h2>
    <MensagemErro v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="edicao-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="feito" role="status" data-testid="edicao-gravada">{{ feito }}</p>

    <template v-if="secao === 'dados'">
      <SanteBotao
        v-if="!editandoDados"
        :rotulo="T('editarDados')"
        variante="secundario"
        data-testid="editar-dados"
        @acionar="abrirDados"
      />
      <form v-else class="grade" data-testid="form-dados" @submit.prevent="gravarDados">
        <div class="campo">
          <label for="ed-nome">{{ T('nome') }}</label>
          <input id="ed-nome" v-model="d.nome" maxlength="70" required data-testid="ed-nome" />
        </div>
        <div class="campo">
          <label for="ed-social">{{ T('nomeSocial') }}</label>
          <input id="ed-social" v-model="d.nomeSocial" maxlength="70" data-testid="ed-social" />
        </div>
        <SanteSelecao v-model="d.sexo" :rotulo="T('sexo')" :opcoes="sexos" />
        <div class="campo">
          <label for="ed-nasc">{{ T('nascimento') }}</label>
          <input id="ed-nasc" v-model="d.nascimento" type="date" />
        </div>
        <div class="campo">
          <label for="ed-mae">{{ T('nomeMae') }}</label>
          <input id="ed-mae" v-model="d.nomeMae" maxlength="70" />
        </div>
        <div class="campo">
          <label for="ed-email">{{ T('email') }}</label>
          <input id="ed-email" v-model="d.email" type="email" maxlength="50" data-testid="ed-email" />
        </div>
        <div class="campo">
          <label for="ed-cel">{{ T('celular') }}</label>
          <input id="ed-cel" v-model="d.celular" inputmode="tel" maxlength="15" />
        </div>
        <p class="nota">{{ T('cpfFixo') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="T('gravar')"
            tipo="submit"
            :desabilitado="gravando"
            data-testid="gravar-dados"
          />
          <SanteBotao :rotulo="T('cancelar')" variante="secundario" @acionar="editandoDados = false" />
        </div>
      </form>
    </template>

    <template v-if="secao === 'registros'">
      <h3 id="edicao-registros">{{ t('cadastro.profissionais.registros') }}</h3>
      <ul aria-labelledby="edicao-registros">
        <li v-for="r in ficha.registros" :key="r.id" data-testid="registro-edicao">
          {{ rotuloRegistro(r) }}
          <span v-if="r.cbo === SOMBRA"> · {{ T('mantido') }}</span>
          <SanteBotao
            v-else-if="situacaoRegistro && r.ativo !== false"
            :rotulo="T('inativar')"
            variante="secundario"
            :desabilitado="gravando"
            data-testid="inativar-registro"
            @acionar="alternarRegistro(r)"
          />
          <SanteBotao
            v-else-if="situacaoRegistro"
            :rotulo="T('reativar')"
            variante="secundario"
            :desabilitado="gravando"
            data-testid="reativar-registro"
            @acionar="alternarRegistro(r)"
          />
          <SanteBotao
            v-if="
              r.cbo !== SOMBRA &&
              pode('cadastro.profissional.excluir') &&
              operacaoLigada(ficha, 'cadastro.excluirRegistroProfissional')
            "
            :rotulo="T('excluirRegistro')"
            variante="texto"
            :desabilitado="gravando"
            data-testid="excluir-registro"
            @acionar="excluirRegistro(r)"
          />
        </li>
      </ul>
      <form
        class="grade"
        :aria-label="T('novoRegistro')"
        data-testid="form-registro"
        @submit.prevent="incluirRegistro"
      >
        <p class="nota">{{ T('novoRegistroTexto') }}</p>
        <SanteSelecao v-model="nr.conselho" :rotulo="T('conselho')" :opcoes="conselhos" busca />
        <div class="campo">
          <label for="nr-numero">{{ T('numero') }}</label>
          <input
            id="nr-numero"
            v-model="nr.numero"
            inputmode="numeric"
            maxlength="9"
            data-testid="nr-numero"
          />
        </div>
        <SanteSelecao v-model="nr.uf" :rotulo="T('uf')" :opcoes="ufs" busca data-testid="nr-uf" />
        <SanteSelecao
          v-model="nr.cbo"
          :rotulo="T('cbo')"
          :opcoes="lista(o?.cbos)"
          busca
          data-testid="nr-cbo"
        />
        <label class="marcar"
          ><input v-model="nr.credenciarTodos" type="checkbox" /> {{ T('credenciarTodos') }}</label
        >
        <SanteBotao
          :rotulo="T('novoRegistro')"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="incluir-registro"
        />
      </form>
    </template>

    <template v-if="secao === 'especialidades'">
      <h3 id="edicao-especialidades">{{ t('cadastro.profissionais.especialidades') }}</h3>
      <ul aria-labelledby="edicao-especialidades">
        <li v-for="e in especialidadesEditaveis" :key="`${e.registro}-${e.codigo}`">
          {{ e.nome }}
          <SanteBotao
            :rotulo="
              e.ativo
                ? T('inativarEspecialidade', { nome: e.nome })
                : T('reativarEspecialidade', { nome: e.nome })
            "
            variante="texto"
            :desabilitado="gravando"
            @acionar="
              executar(() =>
                definirEspecialidadeProfissional(ficha.id, {
                  registro: e.registro,
                  especialidade: e.codigo,
                  ativo: !e.ativo,
                }),
              )
            "
          />
        </li>
      </ul>
      <form
        class="grade"
        :aria-label="T('incluirEspecialidade')"
        data-testid="form-especialidade"
        @submit.prevent="incluirEspecialidade"
      >
        <SanteSelecao
          v-model="ne.registro"
          :rotulo="T('registroAlvo')"
          :opcoes="registros"
          busca
          data-testid="ne-registro"
        />
        <SanteSelecao
          v-model="ne.especialidade"
          :rotulo="T('especialidade')"
          :opcoes="lista(o?.especialidades)"
          busca
          data-testid="ne-especialidade"
        />
        <SanteBotao
          :rotulo="T('incluirEspecialidade')"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="incluir-especialidade"
        />
      </form>
    </template>

    <template v-if="secao === 'convenios'">
      <h3 id="edicao-convenios">{{ t('cadastro.profissionais.credenciamentos') }}</h3>
      <ul aria-labelledby="edicao-convenios">
        <li v-for="c in credenciamentosEditaveis" :key="`${c.registro}-${c.convenio}`">
          {{ c.nome ?? c.convenio }}
          <SanteBotao
            :rotulo="T('descredenciar', { nome: c.nome ?? c.convenio })"
            variante="destrutivo"
            :confirmacao="T('confirmaDescredenciar')"
            :desabilitado="gravando"
            @acionar="
              executar(() =>
                credenciarProfissional(ficha.id, {
                  registro: c.registro,
                  convenio: c.convenio,
                  credenciado: false,
                }),
              )
            "
          />
        </li>
      </ul>
      <form
        class="grade"
        :aria-label="T('credenciar')"
        data-testid="form-credenciamento"
        @submit.prevent="credenciar"
      >
        <SanteSelecao
          v-model="nc.registro"
          :rotulo="T('registroAlvo')"
          :opcoes="registros"
          busca
          data-testid="nc-registro"
        />
        <SanteSelecao
          v-model="nc.convenio"
          :rotulo="T('convenio')"
          :opcoes="lista(o?.convenios)"
          busca
          data-testid="nc-convenio"
        />
        <SanteBotao
          :rotulo="T('credenciar')"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="credenciar"
        />
      </form>
    </template>
    <SanteDialogoGravacao
      v-model:visivel="dialogo"
      :pedido="pedido"
      @feito="feitoDialogo"
      @falha="falhaDialogo"
    />
  </section>
</template>

<style scoped>
.edicao {
  border-top: 1px solid var(--sgh-borda);
  padding-top: var(--sgh-espaco-2);
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: flex;
  flex-direction: column;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.nota {
  grid-column: 1 / -1;
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  min-height: var(--sgh-alvo-minimo);
}
</style>
