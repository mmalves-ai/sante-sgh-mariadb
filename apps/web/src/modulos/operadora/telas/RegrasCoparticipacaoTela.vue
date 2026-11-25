<script setup lang="ts">
// Regras de coparticipação do plano e do contrato (08-SGO L98, C2-116), atalho da tela de cobrança: a regra geral e as
// restritas a tipo de guia, grupo de procedimentos, procedimento e regime, cada uma com os tetos por evento, mês e ano
// (RN ANS 433: o fator moderador não pode impedir o acesso). No lançamento vale a mais específica que casa com o evento;
// a do contrato prevalece sobre a do plano no mesmo grau. A regra nunca é apagada: encerra-se pela vigência, e o
// histórico fica à vista. Validação na hora; gravar só com operadora.beneficiario.editar.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerTelaCobranca } from '../api-cobranca.js';
import {
  buscarProcedimentos,
  encerrarRegra,
  incluirRegra,
  lerOpcoes,
  lerRegras,
  type Opcao,
  type OpcoesRegra,
  type RegraCoparticipacao,
  type TipoCoparticipacao,
} from '../api-regras-coparticipacao.js';
import { mensagensRegrasCoparticipacao } from '../i18n-regras-coparticipacao.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensRegrasCoparticipacao } });
const f_ = (s: string) => t(`faltas.${s}`);

const podeGravar = computed(() => pode('operadora.beneficiario.editar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const opcoes = ref<OpcoesRegra>({ planos: [], contratos: [], tiposGuia: [], grupos: [], regimes: [] });
const escopo = ref<'plano' | 'contrato' | null>('plano');
const alvo = ref<number | null>(null);
const regras = ref<RegraCoparticipacao[]>([]);

const moeda = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};
const lista = (xs: Opcao[], vazio: string) => [
  { valor: null as number | null, rotulo: vazio },
  ...xs.map((o) => ({ valor: o.id as number | null, rotulo: o.rotulo })),
];

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

void tentar(async () => {
  const t = await lerTelaCobranca();
  operadoras.value = t.operadoras.map((o) => ({
    valor: o.id,
    rotulo: `${o.razaoSocial} (${o.registroAns})`,
  }));
  if (t.operadoras.length === 1) operadora.value = t.operadoras[0]!.id;
});
watch(operadora, async (op) => {
  regras.value = [];
  alvo.value = null;
  if (op) opcoes.value = (await tentar(() => lerOpcoes(op))) ?? opcoes.value;
});
watch(escopo, () => {
  alvo.value = null;
  regras.value = [];
});
const alvos = computed(() =>
  lista(escopo.value === 'contrato' ? opcoes.value.contratos : opcoes.value.planos, t('escolha')),
);
async function carregar() {
  if (!operadora.value || !alvo.value) return;
  const a =
    escopo.value === 'contrato'
      ? { plano: null, contrato: alvo.value }
      : { plano: alvo.value, contrato: null };
  regras.value = (await tentar(() => lerRegras(operadora.value!, a))) ?? [];
}
watch(alvo, () => void carregar());

// ---------------------------------------------------------------- nova regra -------------------------------------
const TIPOS = computed(() =>
  (['percentual', 'valor_fixo', 'nenhuma'] as TipoCoparticipacao[]).map((valor) => ({
    valor,
    rotulo: t(`tipos.${valor}`),
  })),
);
const nova = ref({
  codigo: '',
  descricao: '',
  tipo: 'percentual' as TipoCoparticipacao | null,
  valor: '',
  tetoEvento: '',
  tetoMensal: '',
  tetoAnual: '',
  inicio: '' as string | null,
  fim: '' as string | null,
  tipoGuia: null as number | null,
  grupo: null as number | null,
  regime: null as number | null,
  procedimento: null as number | null,
});
const buscaProc = ref('');
const procedimentos = ref<Opcao[]>([]);
let espera: ReturnType<typeof setTimeout> | null = null;
watch(buscaProc, (t) => {
  if (espera) clearTimeout(espera);
  espera = setTimeout(async () => {
    procedimentos.value = t.trim().length >= 2 ? ((await tentar(() => buscarProcedimentos(t))) ?? []) : [];
  }, 300);
});
const opcoesProc = computed(() => lista(procedimentos.value, t('qualquerProcedimento')));

/** O que falta ou está errado, na hora (a mesma regra do servidor; o servidor confere de novo). */
const falta = computed(() => {
  const f: string[] = [];
  const x = nova.value;
  if (!alvo.value) f.push(f_(escopo.value === 'contrato' ? 'contrato' : 'plano'));
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(x.codigo.trim())) f.push(f_('codigo'));
  if (x.descricao.trim().length < 3) f.push(f_('descricao'));
  const v = numeroBr(x.valor);
  if (x.tipo === 'percentual' && (v === null || v <= 0 || v > 100)) f.push(f_('percentual'));
  if (x.tipo === 'valor_fixo' && (v === null || v <= 0)) f.push(f_('valorFixo'));
  const [e, m, a] = [x.tetoEvento, x.tetoMensal, x.tetoAnual].map(numeroBr);
  if ([e, m, a].some((n) => n !== undefined && n !== null && n <= 0)) f.push(f_('tetosPositivos'));
  const acima = (p: number | null | undefined, q: number | null | undefined) =>
    p != null && q != null && p > q;
  if (acima(e, m) || acima(m, a) || acima(e, a)) f.push(f_('ordemTetos'));
  if (x.tipo === 'nenhuma' && (e !== null || m !== null || a !== null)) f.push(f_('isencaoSemTeto'));
  if (x.procedimento !== null && x.grupo !== null) f.push(f_('procOuGrupo'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.inicio ?? '')) f.push(f_('inicio'));
  if (x.fim && x.inicio && x.fim < x.inicio) f.push(f_('fimDepois'));
  return f;
});
async function salvar() {
  const x = nova.value;
  const r = await tentar(
    () =>
      incluirRegra(operadora.value!, {
        codigo: x.codigo.trim(),
        descricao: x.descricao.trim(),
        plano: escopo.value === 'plano' ? alvo.value : null,
        contrato: escopo.value === 'contrato' ? alvo.value : null,
        tipo: x.tipo!,
        valor: x.tipo === 'nenhuma' ? null : numeroBr(x.valor),
        tetoEvento: numeroBr(x.tetoEvento),
        tetoMensal: numeroBr(x.tetoMensal),
        tetoAnual: numeroBr(x.tetoAnual),
        procedimento: x.procedimento,
        grupo: x.grupo,
        tipoGuia: x.tipoGuia,
        regime: x.regime,
        inicio: x.inicio!,
        fim: x.fim || null,
      }),
    t('cadastrada'),
  );
  if (r) {
    nova.value = { ...nova.value, codigo: '', descricao: '', valor: '', procedimento: null };
    await carregar();
    aviso.value = t('cadastrada');
  }
}

// ---------------------------------------------------------------- encerrar ---------------------------------------
const encerrando = ref<RegraCoparticipacao | null>(null);
const fimEncerrar = ref<string | null>('');
const fimValido = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(fimEncerrar.value ?? ''));
async function confirmarEncerrar() {
  const r = encerrando.value;
  if (!r || !fimValido.value) return;
  const g = await tentar(
    () => encerrarRegra(r.id, { versao: r.versao, fim: fimEncerrar.value! }),
    t('encerrada'),
  );
  if (g) {
    encerrando.value = null;
    fimEncerrar.value = '';
    await carregar();
    aviso.value = t('encerrada');
  }
}
const escopoDe = (r: RegraCoparticipacao) =>
  [
    r.procedimentoDescricao && t('escopoProcedimento', { d: r.procedimentoDescricao }),
    r.grupoDescricao && t('escopoGrupo', { d: r.grupoDescricao }),
    r.tipoGuiaDescricao && t('escopoGuia', { d: r.tipoGuiaDescricao }),
    r.regimeDescricao && t('escopoRegime', { d: r.regimeDescricao }),
  ]
    .filter(Boolean)
    .join(' · ') || t('geral');
const cobranca = (r: RegraCoparticipacao) =>
  r.tipo === 'nenhuma' ? t('isento') : r.tipo === 'percentual' ? `${r.valor}%` : moeda(r.valor);
</script>

<template>
  <section class="copart" aria-labelledby="copart-titulo" data-testid="tela-regras-coparticipacao">
    <h1 id="copart-titulo">{{ t('titulo') }}</h1>
    <p class="copart__ajuda">{{ t('ajuda') }}</p>
    <RouterLink to="/operadora/cobranca" data-testid="link-cobranca">{{ t('voltar') }}</RouterLink>
    <SanteAlerta
      v-if="!podeGravar"
      :texto="t('somenteLeitura')"
      variante="info"
      data-testid="copart-somente-leitura"
    />
    <div class="copart__linha">
      <SanteSelecao
        id="copart-operadora"
        v-model="operadora"
        :rotulo="t('operadora')"
        :opcoes="operadoras"
        data-testid="copart-operadora"
      />
      <SanteSelecao
        id="copart-escopo"
        v-model="escopo"
        :rotulo="t('regraDo')"
        :opcoes="[
          { valor: 'plano', rotulo: t('escopoPlano') },
          { valor: 'contrato', rotulo: t('escopoContrato') },
        ]"
        data-testid="copart-escopo"
      />
      <SanteSelecao
        id="copart-alvo"
        v-model="alvo"
        :rotulo="escopo === 'contrato' ? t('contrato') : t('plano')"
        :opcoes="alvos"
        data-testid="copart-alvo"
      />
    </div>
    <p v-if="erro" class="copart__erro" role="alert" data-testid="copart-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="copart-aviso">{{ aviso }}</p>

    <table v-if="regras.length" class="copart__tabela" data-testid="copart-regras">
      <thead>
        <tr>
          <th scope="col">{{ t('colunas.codigo') }}</th>
          <th scope="col">{{ t('colunas.escopo') }}</th>
          <th scope="col">{{ t('colunas.cobranca') }}</th>
          <th scope="col">{{ t('colunas.tetoEvento') }}</th>
          <th scope="col">{{ t('colunas.tetoMes') }}</th>
          <th scope="col">{{ t('colunas.tetoAno') }}</th>
          <th scope="col">{{ t('colunas.vigencia') }}</th>
          <th scope="col">
            <span class="sgh-visualmente-oculto">{{ t('colunas.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras" :key="r.id" :data-testid="`copart-regra-${r.codigo}`">
          <td>{{ r.codigo }} — {{ r.descricao }}</td>
          <td>{{ escopoDe(r) }}</td>
          <td>{{ cobranca(r) }}</td>
          <td>{{ moeda(r.tetoEvento) }}</td>
          <td>{{ moeda(r.tetoMensal) }}</td>
          <td>{{ moeda(r.tetoAnual) }}</td>
          <td>
            {{ t('periodo', { inicio: dataBr(r.inicio), fim: dataBr(r.fim) }) }}
            <strong v-if="r.vigente">{{ t('vigente') }}</strong>
          </td>
          <td>
            <SanteBotao
              v-if="podeGravar && r.vigente"
              :rotulo="t('encerrar')"
              variante="secundario"
              :data-testid="`copart-encerrar-${r.codigo}`"
              @click="encerrando = r"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="alvo" data-testid="copart-vazio">{{ t('vazio') }}</p>

    <div v-if="encerrando" class="copart__cartao" data-testid="copart-encerrar">
      <p>{{ t('encerrarTexto', { codigo: encerrando.codigo }) }}</p>
      <SanteData v-model="fimEncerrar" :rotulo="t('ultimoDia')" editavel data-testid="copart-fim-encerrar" />
      <div class="copart__linha">
        <SanteBotao
          :rotulo="t('confirmarEncerrar')"
          :desabilitado="!fimValido"
          data-testid="copart-confirmar-encerrar"
          @click="confirmarEncerrar"
        />
        <SanteBotao :rotulo="t('cancelar')" variante="secundario" @click="encerrando = null" />
      </div>
    </div>

    <form v-if="podeGravar && alvo" class="copart__cartao" data-testid="copart-nova" @submit.prevent="salvar">
      <h2>{{ t('novaRegra') }}</h2>
      <div class="copart__linha">
        <SanteCampoTexto
          id="copart-codigo"
          v-model="nova.codigo"
          :max-bytes="30"
          :rotulo="t('codigo')"
          data-testid="copart-codigo"
        />
        <SanteCampoTexto
          id="copart-descricao"
          v-model="nova.descricao"
          :max-bytes="150"
          :rotulo="t('descricao')"
          data-testid="copart-descricao"
        />
      </div>
      <div class="copart__linha">
        <SanteSelecao
          id="copart-tipo"
          v-model="nova.tipo"
          :rotulo="t('cobranca')"
          :opcoes="TIPOS"
          data-testid="copart-tipo"
        />
        <SanteCampoTexto
          v-if="nova.tipo !== 'nenhuma'"
          id="copart-valor"
          v-model="nova.valor"
          :max-bytes="20"
          :rotulo="nova.tipo === 'percentual' ? t('percentual') : t('valor')"
          data-testid="copart-valor"
        />
      </div>
      <fieldset v-if="nova.tipo !== 'nenhuma'" class="copart__linha">
        <legend>{{ t('tetos') }}</legend>
        <SanteCampoTexto
          id="copart-teto-evento"
          v-model="nova.tetoEvento"
          :max-bytes="20"
          :rotulo="t('porEvento')"
          data-testid="copart-teto-evento"
        />
        <SanteCampoTexto
          id="copart-teto-mes"
          v-model="nova.tetoMensal"
          :max-bytes="20"
          :rotulo="t('noMes')"
          data-testid="copart-teto-mes"
        />
        <SanteCampoTexto
          id="copart-teto-ano"
          v-model="nova.tetoAnual"
          :max-bytes="20"
          :rotulo="t('noAno')"
          data-testid="copart-teto-ano"
        />
      </fieldset>
      <fieldset class="copart__linha">
        <legend>{{ t('valeSo') }}</legend>
        <SanteSelecao
          id="copart-tipo-guia"
          v-model="nova.tipoGuia"
          :rotulo="t('tipoGuia')"
          :opcoes="lista(opcoes.tiposGuia, t('qualquerTipoGuia'))"
          data-testid="copart-tipo-guia"
        />
        <SanteSelecao
          id="copart-regime"
          v-model="nova.regime"
          :rotulo="t('regime')"
          :opcoes="lista(opcoes.regimes, t('qualquerRegime'))"
          data-testid="copart-regime"
        />
        <SanteSelecao
          id="copart-grupo"
          v-model="nova.grupo"
          :rotulo="t('grupo')"
          :opcoes="lista(opcoes.grupos, t('qualquerGrupo'))"
          data-testid="copart-grupo"
        />
        <SanteCampoTexto
          id="copart-busca-proc"
          v-model="buscaProc"
          :max-bytes="60"
          :rotulo="t('buscaProc')"
          data-testid="copart-busca-proc"
        />
        <SanteSelecao
          id="copart-procedimento"
          v-model="nova.procedimento"
          :rotulo="t('procedimento')"
          :opcoes="opcoesProc"
          data-testid="copart-procedimento"
        />
      </fieldset>
      <div class="copart__linha">
        <SanteData v-model="nova.inicio" :rotulo="t('inicio')" editavel data-testid="copart-inicio" />
        <SanteData v-model="nova.fim" :rotulo="t('fim')" editavel data-testid="copart-fim" />
      </div>
      <p v-if="falta.length" class="copart__erro" data-testid="copart-falta">
        {{ t('falta', { itens: falta.join('; ') }) }}
      </p>
      <SanteBotao
        :rotulo="t('cadastrar')"
        tipo="submit"
        :desabilitado="falta.length > 0"
        data-testid="copart-salvar"
      />
    </form>
  </section>
</template>

<style scoped>
.copart,
.copart__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.copart__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  border: 0;
  padding: 0;
}
.copart__ajuda {
  color: var(--sgh-texto-secundario);
}
.copart__erro {
  color: var(--sgh-alerta);
}
.copart__cartao {
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.copart__tabela {
  width: 100%;
  border-collapse: collapse;
}
.copart__tabela th,
.copart__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
