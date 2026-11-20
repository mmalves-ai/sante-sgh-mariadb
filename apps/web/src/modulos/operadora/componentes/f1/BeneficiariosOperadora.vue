<script setup lang="ts">
// Beneficiários da operadora (M56.2; regras 3 e 8): a busca pela carteirinha, pelo CPF ou pelo início do nome (a lista
// mostra o CPF mascarado e é leitura auditada), a ficha (dados cadastrais, dependentes, vias da carteirinha, também
// auditada), a inclusão do titular e do dependente (a inclusão gera a carteirinha e a primeira via), a alteração, a
// segunda via com o motivo, a exclusão com o motivo (a do titular leva os dependentes) e a reativação. A carteirinha
// sai para impressão. A ligação com o paciente do hospital é só o número do cadastro (regra 8).
import {
  type BeneficiarioFicha,
  type BeneficiarioLista,
  SEXOS_BENEFICIARIO,
  type SexoBeneficiario,
  SITUACOES_BENEFICIARIO,
  VINCULOS_TITULAR,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  baixarBeneficiario,
  emitirViaCarteirinha,
  gravarBeneficiarioOperadora,
  lerBeneficiariosOperadora,
  lerContratosOperadora,
  lerFichaBeneficiario,
  reativarBeneficiario,
} from '../../api-operadora.js';
import { dataBr, hoje, numeroDe, opcoesDe, type Tela } from './comum.js';
import ErroOperadora from './ErroOperadora.vue';

const props = defineProps<{ tela: Tela; operadora: number }>();
const { t } = useI18n();

// ── Busca ──
const busca = ref('');
const situacaoFiltro = ref<string | null>(null);
const filtro = ref<{ busca: string | null; situacao: string | null }>({ busca: null, situacao: null });
const pagina = ref<number[]>([]);
const apos = computed(() => pagina.value.at(-1) ?? null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'beneficiarios', props.operadora, filtro.value, apos.value]),
  queryFn: () =>
    lerBeneficiariosOperadora({
      operadora: props.operadora,
      busca: filtro.value.busca,
      situacao: filtro.value.situacao,
      apos: apos.value,
    }),
});
const contratos = useQuery({
  queryKey: computed(() => ['operadora', 'contratos', props.operadora, null, null]),
  queryFn: () => lerContratosOperadora({ operadora: props.operadora }),
});
const opcoesSituacao = computed(() => [
  { valor: null, rotulo: t('operadora.f1.beneficiario.todasSituacoes') },
  ...opcoesDe(SITUACOES_BENEFICIARIO, false),
]);
function filtrar(): void {
  filtro.value = { busca: busca.value.trim() || null, situacao: situacaoFiltro.value };
  pagina.value = [];
}

// ── Ficha ──
const fichaId = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'beneficiario', fichaId.value]),
  queryFn: () => lerFichaBeneficiario(fichaId.value!),
  enabled: computed(() => fichaId.value !== null),
});
const f = computed(() => ficha.data.value ?? null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const cliente = useQueryClient();
/** Depois de gravar: tudo da operadora fica velho (lista, fichas em cache, contratos com a contagem de ativos). */
async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['operadora'] });
}
async function acao(fn: () => Promise<{ mensagem: string; id: number }>, abrirDepois = true): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    if (abrirDepois) fichaId.value = r.id;
    form.value = null;
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Formulário (titular, dependente, alteração) ──
type Modo =
  | { tipo: 'titular' }
  | { tipo: 'dependente'; titular: BeneficiarioFicha }
  | { tipo: 'alterar'; b: BeneficiarioFicha };
const form = ref<Modo | null>(null);
const contrato = ref<number | null>(null);
const vinculo = ref<number>(1);
const nome = ref('');
const nomeSocial = ref('');
const cpf = ref('');
const nascimento = ref<string | null>(null);
const sexo = ref<SexoBeneficiario>('F');
const cns = ref('');
const nomeMae = ref('');
const inclusao = ref<string | null>(hoje());
const pacienteHospital = ref('');
const opcoesContrato = computed(() =>
  (contratos.data.value?.itens ?? [])
    .filter((c) => c.situacao === 'ativo' || c.id === contrato.value)
    .map((c) => ({ valor: c.id, rotulo: `${c.numero} · ${c.contratanteNome}` })),
);
const opcoesVinculo = computed(() =>
  opcoesDe(VINCULOS_TITULAR, true).filter((o) =>
    form.value?.tipo === 'dependente' ? o.valor !== 1 : form.value?.tipo === 'titular' ? o.valor === 1 : true,
  ),
);
const opcoesSexo = opcoesDe(SEXOS_BENEFICIARIO, false);

function abrirForm(m: Modo): void {
  form.value = m;
  erro.value = null;
  mensagem.value = null;
  const b = m.tipo === 'alterar' ? m.b : null;
  contrato.value =
    b?.contrato ?? (m.tipo === 'dependente' ? m.titular.contrato : (opcoesContrato.value[0]?.valor ?? null));
  vinculo.value = b?.vinculo ?? (m.tipo === 'dependente' ? 5 : 1);
  nome.value = b?.nome ?? '';
  nomeSocial.value = b?.nomeSocial ?? '';
  cpf.value = b?.cpf ?? '';
  nascimento.value = b?.nascimento ?? null;
  sexo.value = b?.sexo ?? 'F';
  cns.value = b?.cns ?? '';
  nomeMae.value = b?.nomeMae ?? '';
  inclusao.value = b?.inclusao ?? (m.tipo === 'dependente' ? m.titular.inclusao : hoje());
  pacienteHospital.value = b?.pacienteHospital ? String(b.pacienteHospital) : '';
}

function gravar(): Promise<void> {
  const m = form.value;
  if (!m) return Promise.resolve();
  const titular = m.tipo === 'dependente' ? m.titular.id : m.tipo === 'alterar' ? m.b.titular : null;
  const corpo = {
    contrato: contrato.value,
    titular,
    vinculo: vinculo.value,
    nome: nome.value,
    nomeSocial: nomeSocial.value || null,
    cpf: cpf.value || null,
    nascimento: nascimento.value,
    sexo: sexo.value,
    cns: cns.value || null,
    nomeMae: nomeMae.value,
    inclusao: inclusao.value,
    pacienteHospital: numeroDe(pacienteHospital.value),
    ...(m.tipo === 'alterar' ? { versao: m.b.versao } : {}),
  };
  return acao(() => gravarBeneficiarioOperadora(m.tipo === 'alterar' ? m.b.id : null, corpo));
}

// ── Segunda via, exclusão, reativação ──
const motivoVia = ref<number | null>(null);
const motivoBaixa = ref<number | null>(null);
const dataBaixa = ref<string | null>(hoje());
const opcoesMotivoVia = computed(() =>
  props.tela.dominios.motivosSegundaVia.map((m) => ({ valor: m.codigo, rotulo: m.nome })),
);
const opcoesMotivoBaixa = computed(() =>
  props.tela.dominios.motivosBaixa.map((m) => ({ valor: m.codigo, rotulo: m.nome })),
);
const segundaVia = (b: BeneficiarioFicha) =>
  acao(() => emitirViaCarteirinha(b.id, { motivo: motivoVia.value, versao: b.versao }));
const baixar = (b: BeneficiarioFicha) =>
  acao(() =>
    baixarBeneficiario(b.id, {
      motivo: motivoBaixa.value ?? -1,
      data: dataBaixa.value ?? '',
      versao: b.versao,
    }),
  );
const reativar = (b: BeneficiarioFicha) => acao(() => reativarBeneficiario(b.id, b.versao));

const vinculoDe = (v: number) => VINCULOS_TITULAR[v as 1] ?? String(v);
const motivoDe = (c: number | null) =>
  c === null
    ? t('operadora.f1.beneficiario.primeiraVia')
    : (props.tela.dominios.motivosSegundaVia.find((m) => m.codigo === c)?.nome ?? String(c));
const carteirinhaFormatada = (n: string) =>
  n.length === 16 ? `${n.slice(0, 6)} ${n.slice(6, 15)} ${n.slice(15)}` : n;
const nomeDe = (b: BeneficiarioLista | BeneficiarioFicha) => b.nomeSocial ?? b.nome;
function imprimir(): void {
  window.print();
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-benef-titulo" data-testid="operadora-beneficiarios">
    <h2 id="ope-benef-titulo">{{ t('operadora.f1.beneficiario.titulo') }}</h2>
    <form class="campos" role="search" @submit.prevent="filtrar">
      <SanteCampoTexto v-model="busca" :rotulo="t('operadora.f1.beneficiario.buscar')" :max-bytes="60" />
      <SanteSelecao
        v-model="situacaoFiltro"
        :rotulo="t('operadora.f1.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="beneficiario-situacao-filtro"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.buscar')"
          variante="secundario"
          tipo="submit"
          data-testid="beneficiario-buscar"
        />
        <SanteBotao
          v-if="tela.acoes.editar && !form"
          :rotulo="t('operadora.f1.beneficiario.novoTitular')"
          variante="secundario"
          data-testid="beneficiario-incluir-titular"
          @acionar="abrirForm({ tipo: 'titular' })"
        />
      </div>
    </form>
    <p v-if="mensagem" role="status" data-testid="mensagem-beneficiario">{{ mensagem }}</p>
    <ErroOperadora v-if="erro" :erro="erro" />

    <form v-if="form" class="campos" data-testid="form-beneficiario" @submit.prevent="gravar">
      <SanteSelecao
        v-model="contrato"
        :rotulo="t('operadora.f1.beneficiario.contrato')"
        :opcoes="opcoesContrato"
        :desabilitado="form.tipo !== 'titular'"
        data-testid="beneficiario-contrato"
      />
      <SanteSelecao
        v-model="vinculo"
        :rotulo="t('operadora.f1.beneficiario.vinculo')"
        :opcoes="opcoesVinculo"
        data-testid="beneficiario-vinculo"
      />
      <SanteCampoTexto
        v-model="nome"
        :rotulo="t('operadora.f1.beneficiario.nome')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="nomeSocial"
        :rotulo="t('operadora.f1.beneficiario.nomeSocial')"
        :max-bytes="120"
      />
      <SanteCampoTexto v-model="cpf" :rotulo="t('operadora.f1.beneficiario.cpf')" :max-bytes="14" />
      <SanteData v-model="nascimento" :rotulo="t('operadora.f1.beneficiario.nascimento')" editavel />
      <SanteSelecao
        v-model="sexo"
        :rotulo="t('operadora.f1.beneficiario.sexo')"
        :opcoes="opcoesSexo"
        data-testid="beneficiario-sexo"
      />
      <SanteCampoTexto v-model="cns" :rotulo="t('operadora.f1.beneficiario.cns')" :max-bytes="18" />
      <SanteCampoTexto
        v-model="nomeMae"
        :rotulo="t('operadora.f1.beneficiario.nomeMae')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteData v-model="inclusao" :rotulo="t('operadora.f1.beneficiario.inclusao')" editavel />
      <SanteCampoTexto
        v-model="pacienteHospital"
        :rotulo="t('operadora.f1.beneficiario.pacienteHospital')"
        :max-bytes="10"
      />
      <p class="secundario">{{ t('operadora.f1.beneficiario.pacienteAjuda') }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="beneficiario-gravar"
        />
        <SanteBotao :rotulo="t('operadora.f1.cancelar')" variante="texto" @acionar="form = null" />
      </div>
    </form>

    <ErroOperadora v-if="lista.isError.value" :erro="lista.error.value" />
    <table v-else-if="lista.data.value?.itens.length" class="tabela" data-testid="tabela-beneficiarios">
      <thead>
        <tr>
          <th scope="col">{{ t('operadora.f1.beneficiario.nome') }}</th>
          <th scope="col">{{ t('operadora.f1.beneficiario.carteirinha') }}</th>
          <th scope="col">{{ t('operadora.f1.beneficiario.cpf') }}</th>
          <th scope="col">{{ t('operadora.f1.beneficiario.vinculo') }}</th>
          <th scope="col">{{ t('operadora.f1.beneficiario.contrato') }}</th>
          <th scope="col">{{ t('operadora.f1.situacao') }}</th>
          <th scope="col">{{ t('operadora.f1.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in lista.data.value.itens" :key="b.id" :data-testid="`beneficiario-${b.id}`">
          <th scope="row">{{ nomeDe(b) }}</th>
          <td>{{ carteirinhaFormatada(b.carteirinha) }}</td>
          <td>{{ b.cpf ?? '' }}</td>
          <td>{{ vinculoDe(b.vinculo) }}</td>
          <td>{{ b.contratoNumero }} · {{ b.produtoNome }}</td>
          <td :data-situacao="b.situacao">{{ SITUACOES_BENEFICIARIO[b.situacao] }}</td>
          <td>
            <SanteBotao
              :rotulo="t('operadora.f1.beneficiario.abrir')"
              variante="texto"
              :data-testid="`abrir-beneficiario-${b.id}`"
              @acionar="fichaId = b.id"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="lista.data.value">{{ t('operadora.f1.nenhum') }}</p>
    <div class="acoes">
      <SanteBotao
        v-if="pagina.length"
        :rotulo="t('operadora.f1.primeira')"
        variante="texto"
        @acionar="pagina = []"
      />
      <SanteBotao
        v-if="lista.data.value?.proxima"
        :rotulo="t('operadora.f1.proxima')"
        variante="texto"
        @acionar="pagina = [...pagina, lista.data.value!.proxima!]"
      />
    </div>

    <section v-if="f" class="bloco" aria-labelledby="ope-ficha-titulo" data-testid="ficha-beneficiario">
      <h3 id="ope-ficha-titulo">{{ t('operadora.f1.beneficiario.ficha') }}: {{ nomeDe(f) }}</h3>
      <dl class="ficha">
        <dt>{{ t('operadora.f1.beneficiario.carteirinha') }}</dt>
        <dd data-testid="ficha-carteirinha">
          {{ carteirinhaFormatada(f.carteirinha) }} · {{ t('operadora.f1.beneficiario.via') }} {{ f.via }}
        </dd>
        <dt>{{ t('operadora.f1.situacao') }}</dt>
        <dd data-testid="ficha-situacao" :data-situacao="f.situacao">
          {{ SITUACOES_BENEFICIARIO[f.situacao] }}
          <template v-if="f.exclusao">
            · {{ t('operadora.f1.beneficiario.excluidoEm', { data: dataBr(f.exclusao) }) }}</template
          >
        </dd>
        <dt>{{ t('operadora.f1.beneficiario.vinculo') }}</dt>
        <dd>{{ vinculoDe(f.vinculo) }}</dd>
        <dt>{{ t('operadora.f1.beneficiario.contrato') }}</dt>
        <dd>{{ f.contratoNumero }} · {{ f.produtoNome }}</dd>
        <dt>{{ t('operadora.f1.beneficiario.cpf') }}</dt>
        <dd>{{ f.cpf ?? '' }}</dd>
        <dt>{{ t('operadora.f1.beneficiario.nascimento') }}</dt>
        <dd>{{ dataBr(f.nascimento) }}</dd>
        <dt>{{ t('operadora.f1.beneficiario.nomeMae') }}</dt>
        <dd>{{ f.nomeMae }}</dd>
        <dt>{{ t('operadora.f1.beneficiario.inclusao') }}</dt>
        <dd>{{ dataBr(f.inclusao) }}</dd>
        <template v-if="f.pacienteHospital">
          <dt>{{ t('operadora.f1.beneficiario.pacienteHospital') }}</dt>
          <dd>{{ f.pacienteHospital }}</dd>
        </template>
      </dl>

      <div
        class="carteirinha"
        data-testid="cartao-carteirinha"
        aria-labelledby="ope-cartao-titulo"
        role="group"
      >
        <p id="ope-cartao-titulo" class="carteirinha__titulo">
          {{ t('operadora.f1.beneficiario.cartaoTitulo') }}
        </p>
        <p class="carteirinha__numero">{{ carteirinhaFormatada(f.carteirinha) }}</p>
        <p>{{ nomeDe(f) }}</p>
        <p>{{ f.produtoNome }} · {{ t('operadora.f1.beneficiario.via') }} {{ f.via }}</p>
        <p class="secundario">
          {{ t('operadora.f1.beneficiario.registroOperadora') }}: {{ f.registroAnsOperadora }}
        </p>
      </div>

      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.beneficiario.imprimir')"
          variante="secundario"
          @acionar="imprimir"
        />
        <SanteBotao
          :rotulo="t('operadora.f1.beneficiario.fechar')"
          variante="texto"
          @acionar="fichaId = null"
        />
      </div>

      <h4>{{ t('operadora.f1.beneficiario.vias') }}</h4>
      <table class="tabela" data-testid="tabela-vias">
        <thead>
          <tr>
            <th scope="col">{{ t('operadora.f1.beneficiario.via') }}</th>
            <th scope="col">{{ t('operadora.f1.beneficiario.motivo') }}</th>
            <th scope="col">{{ t('operadora.f1.beneficiario.validade') }}</th>
            <th scope="col">{{ t('operadora.f1.beneficiario.emitidaEm') }}</th>
            <th scope="col">{{ t('operadora.f1.beneficiario.emitidaPor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in f.carteirinhas" :key="v.via">
            <th scope="row">{{ v.via }}</th>
            <td>{{ motivoDe(v.motivo) }}</td>
            <td>{{ dataBr(v.validade) }}</td>
            <td>{{ dataBr(v.emitidaEm) }}</td>
            <td>{{ v.emitidaPor }}</td>
          </tr>
        </tbody>
      </table>

      <template v-if="f.titular === null">
        <h4>{{ t('operadora.f1.beneficiario.dependentes') }}</h4>
        <ul v-if="f.dependentes.length" data-testid="lista-dependentes">
          <li v-for="d in f.dependentes" :key="d.id">
            {{ nomeDe(d) }} · {{ vinculoDe(d.vinculo) }} · {{ SITUACOES_BENEFICIARIO[d.situacao] }}
            <SanteBotao
              :rotulo="t('operadora.f1.beneficiario.abrir')"
              variante="texto"
              @acionar="fichaId = d.id"
            />
          </li>
        </ul>
        <p v-else>{{ t('operadora.f1.nenhum') }}</p>
      </template>

      <template v-if="tela.acoes.editar">
        <div class="acoes">
          <SanteBotao
            :rotulo="t('operadora.f1.editar')"
            variante="secundario"
            data-testid="beneficiario-alterar"
            @acionar="abrirForm({ tipo: 'alterar', b: f })"
          />
          <SanteBotao
            v-if="f.titular === null && f.situacao === 'ativo'"
            :rotulo="t('operadora.f1.beneficiario.novoDependente')"
            variante="secundario"
            data-testid="beneficiario-incluir-dependente"
            @acionar="abrirForm({ tipo: 'dependente', titular: f })"
          />
          <SanteBotao
            v-if="f.situacao === 'excluido'"
            :rotulo="t('operadora.f1.beneficiario.reativar')"
            variante="secundario"
            data-testid="beneficiario-reativar"
            @acionar="reativar(f)"
          />
        </div>
        <form
          v-if="f.situacao === 'ativo'"
          class="campos"
          data-testid="form-segunda-via"
          @submit.prevent="segundaVia(f)"
        >
          <SanteSelecao
            v-model="motivoVia"
            :rotulo="t('operadora.f1.beneficiario.motivoSegundaVia')"
            :opcoes="opcoesMotivoVia"
            data-testid="segunda-via-motivo"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('operadora.f1.beneficiario.segundaVia')"
              variante="secundario"
              tipo="submit"
              :desabilitado="ocupado"
              data-testid="segunda-via-emitir"
            />
          </div>
        </form>
        <form v-if="f.situacao !== 'excluido'" class="campos" data-testid="form-baixa" @submit.prevent>
          <SanteSelecao
            v-model="motivoBaixa"
            :rotulo="t('operadora.f1.beneficiario.motivoBaixa')"
            :opcoes="opcoesMotivoBaixa"
            data-testid="baixa-motivo"
          />
          <SanteData v-model="dataBaixa" :rotulo="t('operadora.f1.beneficiario.dataBaixa')" editavel />
          <SanteAlerta
            v-if="f.titular === null"
            :texto="t('operadora.f1.beneficiario.baixaTitular')"
            variante="aviso"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('operadora.f1.beneficiario.baixa')"
              variante="destrutivo"
              :confirmacao="t('operadora.f1.beneficiario.confirmarBaixa')"
              :desabilitado="ocupado"
              data-testid="baixa-confirmar"
              @acionar="baixar(f)"
            />
          </div>
        </form>
      </template>
    </section>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.ficha {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
}
.ficha dt {
  font-weight: 600;
}
.ficha dd {
  margin: 0;
}
.carteirinha {
  max-width: 22rem;
  border: 2px solid var(--p-content-border-color);
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
  display: grid;
  gap: 0.15rem;
}
.carteirinha p {
  margin: 0;
}
.carteirinha__titulo {
  font-weight: 600;
}
.carteirinha__numero {
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
}
h3,
h4 {
  margin: 0;
}
</style>
