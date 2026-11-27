<script setup lang="ts">
// Regras de franquia do plano e do contrato (08-SGO L98, C2-116, decisão 56), ao lado das regras de coparticipação: o
// limite da janela de acúmulo (evento, dia, mês, ano ou vigência do contrato), a parte do evento que entra (inteiro,
// percentual ou fator), o teto por guia e a internação (dias alcançados e a guia ambulatorial feita durante ela). A
// regra do contrato prevalece sobre a do plano; sem regra não há franquia e nada trava. A regra nunca é apagada:
// encerra-se pela vigência. Validação na hora (a mesma do domínio; o servidor confere de novo); gravar só com
// operadora.beneficiario.editar. O lançamento na cobrança é a rota /api/operadora/cobrancas/franquia.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerTelaCobranca } from '../api-cobranca.js';
import {
  encerrarRegraFranquia,
  incluirRegraFranquia,
  lerOpcoesFranquia,
  lerRegrasFranquia,
  type Opcao,
  type OpcoesFranquia,
  PERIODOS_ACUMULO,
  type PeriodoAcumulo,
  type RegraFranquia,
} from '../api-regras-franquia.js';
import { mensagensRegrasFranquia } from '../i18n-regras-franquia.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensRegrasFranquia } });
const f_ = (s: string) => t(`faltas.${s}`);

const podeGravar = computed(() => pode('operadora.beneficiario.editar'));
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const opcoes = ref<OpcoesFranquia>({ planos: [], contratos: [], tiposFranquia: [], grupos: [], regimes: [] });
const escopo = ref<'plano' | 'contrato' | null>('plano');
const alvo = ref<number | null>(null);
const regras = ref<RegraFranquia[]>([]);

const moeda = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const s = v.trim().replace(/\./g, '').replace(',', '.');
  return s === '' || Number.isNaN(Number(s)) ? null : Number(s);
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
  const c = await lerTelaCobranca();
  operadoras.value = c.operadoras.map((o) => ({
    valor: o.id,
    rotulo: `${o.razaoSocial} (${o.registroAns})`,
  }));
  if (c.operadoras.length === 1) operadora.value = c.operadoras[0]!.id;
});
watch(operadora, async (op) => {
  regras.value = [];
  alvo.value = null;
  if (op) opcoes.value = (await tentar(() => lerOpcoesFranquia(op))) ?? opcoes.value;
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
  regras.value = (await tentar(() => lerRegrasFranquia(operadora.value!, a))) ?? [];
}
watch(alvo, () => void carregar());

// ---------------------------------------------------------------- nova regra -------------------------------------
const PERIODOS = computed(() => PERIODOS_ACUMULO.map((valor) => ({ valor, rotulo: t(`periodos.${valor}`) })));
const nova = ref({
  codigo: '',
  descricao: '',
  tipoFranquia: null as number | null,
  valor: '',
  percentual: '',
  fator: '',
  tetoPorGuia: '',
  periodoAcumulo: 'mes' as PeriodoAcumulo | null,
  diasInternacao: '',
  ambulatorial: false,
  inicio: '' as string | null,
  fim: '' as string | null,
});

/** O que falta ou está errado, na hora (as mesmas regras de problemasDaFranquia no domínio). */
const falta = computed(() => {
  const f: string[] = [];
  const x = nova.value;
  if (!alvo.value) f.push(f_(escopo.value === 'contrato' ? 'contrato' : 'plano'));
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(x.codigo.trim())) f.push(f_('codigo'));
  if (x.descricao.trim().length < 3) f.push(f_('descricao'));
  if (!x.tipoFranquia) f.push(f_('tipoFranquia'));
  const [v, p, fa, teto] = [x.valor, x.percentual, x.fator, x.tetoPorGuia].map(numeroBr);
  if (v === null && p === null && fa === null) f.push(f_('semValor'));
  if (v != null && v <= 0) f.push(f_('limite'));
  if (p != null && (p <= 0 || p > 100)) f.push(f_('percentual'));
  if (fa != null && (fa <= 0 || fa > 1)) f.push(f_('fator'));
  if (p != null && fa != null) f.push(f_('percentualOuFator'));
  if (teto != null && teto <= 0) f.push(f_('teto'));
  if (teto != null && v != null && teto > v) f.push(f_('tetoAcima'));
  const d = x.diasInternacao.trim();
  if (d !== '' && !/^[1-9]\d{0,3}$/.test(d)) f.push(f_('dias'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.inicio ?? '')) f.push(f_('inicio'));
  if (x.fim && x.inicio && x.fim < x.inicio) f.push(f_('fimDepois'));
  return f;
});
async function salvar() {
  const x = nova.value;
  const r = await tentar(
    () =>
      incluirRegraFranquia(operadora.value!, {
        codigo: x.codigo.trim(),
        descricao: x.descricao.trim(),
        tipoFranquia: x.tipoFranquia!,
        plano: escopo.value === 'plano' ? alvo.value : null,
        contrato: escopo.value === 'contrato' ? alvo.value : null,
        grupo: null,
        regime: null,
        valor: numeroBr(x.valor),
        percentual: numeroBr(x.percentual),
        fator: numeroBr(x.fator),
        tetoPorGuia: numeroBr(x.tetoPorGuia),
        periodoAcumulo: x.periodoAcumulo ?? 'mes',
        diasInternacao: x.diasInternacao.trim() === '' ? null : Number(x.diasInternacao.trim()),
        cobraGuiaAmbulatorialNaInternacao: x.ambulatorial,
        inicio: x.inicio!,
        fim: x.fim || null,
      }),
    t('cadastrada'),
  );
  if (r) {
    nova.value = { ...nova.value, codigo: '', descricao: '' };
    await carregar();
    aviso.value = t('cadastrada');
  }
}

// ---------------------------------------------------------------- encerrar ---------------------------------------
const encerrando = ref<RegraFranquia | null>(null);
const fimEncerrar = ref<string | null>('');
const fimValido = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(fimEncerrar.value ?? ''));
async function confirmarEncerrar() {
  const r = encerrando.value;
  if (!r || !fimValido.value) return;
  const g = await tentar(
    () => encerrarRegraFranquia(r.id, { versao: r.versao, fim: fimEncerrar.value! }),
    t('encerrada'),
  );
  if (g) {
    encerrando.value = null;
    fimEncerrar.value = '';
    await carregar();
    aviso.value = t('encerrada');
  }
}
const parte = (r: RegraFranquia) =>
  r.percentual !== null
    ? `${r.percentual}%`
    : r.fator !== null
      ? t('fatorDe', { f: r.fator })
      : t('eventoInteiro');
const internacao = (r: RegraFranquia) =>
  (r.diasInternacao !== null ? t('diasInt', { d: r.diasInternacao }) : t('internacaoInteira')) +
  (r.cobraGuiaAmbulatorialNaInternacao ? t('comAmbulatorial') : '');
</script>

<template>
  <section class="franq" aria-labelledby="franq-titulo" data-testid="tela-regras-franquia">
    <h1 id="franq-titulo">{{ t('titulo') }}</h1>
    <p class="franq__ajuda">{{ t('ajuda') }}</p>
    <RouterLink to="/operadora/coparticipacao-regras" data-testid="link-coparticipacao">{{
      t('voltar')
    }}</RouterLink>
    <SanteAlerta
      v-if="!podeGravar"
      :texto="t('somenteLeitura')"
      variante="info"
      data-testid="franq-somente-leitura"
    />
    <div class="franq__linha">
      <SanteSelecao
        id="franq-operadora"
        v-model="operadora"
        :rotulo="t('operadora')"
        :opcoes="operadoras"
        data-testid="franq-operadora"
      />
      <SanteSelecao
        id="franq-escopo"
        v-model="escopo"
        :rotulo="t('regraDo')"
        :opcoes="[
          { valor: 'plano', rotulo: t('escopoPlano') },
          { valor: 'contrato', rotulo: t('escopoContrato') },
        ]"
        data-testid="franq-escopo"
      />
      <SanteSelecao
        id="franq-alvo"
        v-model="alvo"
        :rotulo="escopo === 'contrato' ? t('contrato') : t('plano')"
        :opcoes="alvos"
        data-testid="franq-alvo"
      />
    </div>
    <p v-if="erro" class="franq__erro" role="alert" data-testid="franq-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="franq-aviso">{{ aviso }}</p>

    <table v-if="regras.length" class="franq__tabela" data-testid="franq-regras">
      <thead>
        <tr>
          <th scope="col">{{ t('colunas.codigo') }}</th>
          <th scope="col">{{ t('colunas.tipo') }}</th>
          <th scope="col">{{ t('colunas.limite') }}</th>
          <th scope="col">{{ t('colunas.parte') }}</th>
          <th scope="col">{{ t('colunas.teto') }}</th>
          <th scope="col">{{ t('colunas.janela') }}</th>
          <th scope="col">{{ t('colunas.internacao') }}</th>
          <th scope="col">{{ t('colunas.vigencia') }}</th>
          <th scope="col">
            <span class="sgh-visualmente-oculto">{{ t('colunas.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras" :key="r.id" :data-testid="`franq-regra-${r.codigo}`">
          <td>{{ r.codigo }} — {{ r.descricao }}</td>
          <td>{{ r.tipoFranquiaDescricao ?? '—' }}</td>
          <td>{{ r.valor === null ? t('semLimite') : moeda(r.valor) }}</td>
          <td>{{ parte(r) }}</td>
          <td>{{ moeda(r.tetoPorGuia) }}</td>
          <td>{{ t(`periodos.${r.periodoAcumulo}`) }}</td>
          <td>{{ internacao(r) }}</td>
          <td>
            {{ t('periodo', { inicio: dataBr(r.inicio), fim: dataBr(r.fim) }) }}
            <strong v-if="r.vigente">{{ t('vigente') }}</strong>
          </td>
          <td>
            <SanteBotao
              v-if="podeGravar && r.vigente"
              :rotulo="t('encerrar')"
              variante="secundario"
              :data-testid="`franq-encerrar-${r.codigo}`"
              @acionar="encerrando = r"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="alvo" data-testid="franq-vazio">{{ t('vazio') }}</p>

    <div v-if="encerrando" class="franq__cartao" data-testid="franq-encerrar">
      <p>{{ t('encerrarTexto', { codigo: encerrando.codigo }) }}</p>
      <SanteData v-model="fimEncerrar" :rotulo="t('ultimoDia')" editavel data-testid="franq-fim-encerrar" />
      <div class="franq__linha">
        <SanteBotao
          :rotulo="t('confirmarEncerrar')"
          :desabilitado="!fimValido"
          data-testid="franq-confirmar-encerrar"
          @acionar="confirmarEncerrar"
        />
        <SanteBotao :rotulo="t('cancelar')" variante="secundario" @acionar="encerrando = null" />
      </div>
    </div>

    <form v-if="podeGravar && alvo" class="franq__cartao" data-testid="franq-nova" @submit.prevent="salvar">
      <h2>{{ t('novaRegra') }}</h2>
      <div class="franq__linha">
        <SanteCampoTexto
          id="franq-codigo"
          v-model="nova.codigo"
          :max-bytes="30"
          :rotulo="t('codigo')"
          data-testid="franq-codigo"
        />
        <SanteCampoTexto
          id="franq-descricao"
          v-model="nova.descricao"
          :max-bytes="150"
          :rotulo="t('descricao')"
          data-testid="franq-descricao"
        />
        <SanteSelecao
          id="franq-tipo"
          v-model="nova.tipoFranquia"
          :rotulo="t('tipoFranquia')"
          :opcoes="lista(opcoes.tiposFranquia, t('escolha'))"
          data-testid="franq-tipo"
        />
      </div>
      <div class="franq__linha">
        <SanteCampoTexto
          id="franq-limite"
          v-model="nova.valor"
          :max-bytes="20"
          :rotulo="t('limite')"
          data-testid="franq-limite"
        />
        <SanteCampoTexto
          id="franq-percentual"
          v-model="nova.percentual"
          :max-bytes="20"
          :rotulo="t('percentual')"
          data-testid="franq-percentual"
        />
        <SanteCampoTexto
          id="franq-fator"
          v-model="nova.fator"
          :max-bytes="20"
          :rotulo="t('fator')"
          data-testid="franq-fator"
        />
        <SanteCampoTexto
          id="franq-teto"
          v-model="nova.tetoPorGuia"
          :max-bytes="20"
          :rotulo="t('tetoPorGuia')"
          data-testid="franq-teto"
        />
        <SanteSelecao
          id="franq-janela"
          v-model="nova.periodoAcumulo"
          :rotulo="t('janela')"
          :opcoes="PERIODOS"
          data-testid="franq-janela"
        />
      </div>
      <div class="franq__linha">
        <SanteCampoTexto
          id="franq-dias"
          v-model="nova.diasInternacao"
          :max-bytes="4"
          :rotulo="t('diasInternacao')"
          data-testid="franq-dias"
        />
        <label class="franq__marca">
          <input v-model="nova.ambulatorial" type="checkbox" data-testid="franq-ambulatorial" />
          {{ t('ambulatorial') }}
        </label>
      </div>
      <div class="franq__linha">
        <SanteData v-model="nova.inicio" :rotulo="t('inicio')" editavel data-testid="franq-inicio" />
        <SanteData v-model="nova.fim" :rotulo="t('fim')" editavel data-testid="franq-fim" />
      </div>
      <p v-if="falta.length" class="franq__erro" data-testid="franq-falta">
        {{ t('falta', { itens: falta.join('; ') }) }}
      </p>
      <SanteBotao
        :rotulo="t('cadastrar')"
        tipo="submit"
        :desabilitado="falta.length > 0"
        data-testid="franq-salvar"
      />
    </form>
  </section>
</template>

<style scoped>
.franq,
.franq__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.franq__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  border: 0;
  padding: 0;
}
.franq__marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.franq__ajuda {
  color: var(--sgh-texto-secundario);
}
.franq__erro {
  color: var(--sgh-alerta);
}
.franq__cartao {
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.franq__tabela {
  width: 100%;
  border-collapse: collapse;
}
.franq__tabela th,
.franq__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
