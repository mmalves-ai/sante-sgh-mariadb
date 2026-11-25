<script setup lang="ts">
// Declarações periódicas da operadora (08-SGO L110): a taxa de saúde suplementar apurada por trimestre (com a conta de
// cada plano impressa, a guia e o pagamento), a conferência da base de beneficiários devolvida pela ANS (arquivo
// importado, divergências tratadas uma a uma) e a declaração anual de serviços médicos à Receita (DMED: gerar,
// baixar o arquivo, registrar a entrega com recibo). Uma operadora escolhida vale para as três abas.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerApoioAns } from '../api-ans.js';
import {
  type ApuracaoTps,
  apurarTps,
  type Conferencia,
  type Declaracao,
  type Divergencia,
  gerarDmed,
  importarConferencia,
  lerApuracoesTps,
  lerArquivoDmed,
  lerConferencias,
  lerDeclaracoes,
  lerDivergencias,
  passoDmed,
  passoTps,
  type ResultadoApuracao,
  tratarDivergencia,
} from '../api-declaracoes-ans.js';

const { t } = useI18n();
type Aba = 'tps' | 'conferencia' | 'dmed';
const aba = ref<Aba>('tps');
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : t('operadoraDeclaracoes.vazio'));

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
  const a = await lerApoioAns();
  operadoras.value = a.operadoras.map((o) => ({ valor: o.id, rotulo: `${o.nome} (${o.registroAns})` }));
  if (a.operadoras.length === 1) operadora.value = a.operadoras[0]!.id;
});

// ---------------------------------------------------------------- TPS --------------------------------------------
const anoAtual = new Date().getFullYear();
const anoTps = ref(String(anoAtual));
const trimestre = ref<number | null>(null);
const trimestres = computed(() =>
  [1, 2, 3, 4].map((n) => ({ valor: n, rotulo: t('operadoraDeclaracoes.tps.trimestreOpcao', { n }) })),
);
const apuracoes = ref<ApuracaoTps[]>([]);
const ultima = ref<ResultadoApuracao | null>(null);
const nossoNumero = ref<Record<number, string>>({});
const pagoEm = ref<Record<number, string>>({});
const valorPago = ref<Record<number, string>>({});
const podeApurar = computed(
  () => operadora.value !== null && trimestre.value !== null && /^\d{4}$/.test(anoTps.value),
);
const situacaoTps = (s: ApuracaoTps['situacao']) => t(`operadoraDeclaracoes.tps.situacoes.${s}`);

async function carregarTps() {
  if (operadora.value === null) return;
  apuracoes.value = (await tentar(() => lerApuracoesTps(operadora.value!))) ?? [];
}
async function apurar() {
  if (!podeApurar.value) return;
  ultima.value = await tentar(
    () => apurarTps(operadora.value!, Number(anoTps.value), trimestre.value!),
    t('operadoraDeclaracoes.tps.apurado'),
  );
  await carregarTps();
}
async function passo(a: ApuracaoTps, para: 'guia_emitida' | 'paga' | 'cancelada') {
  const r = await tentar(
    () =>
      passoTps(a.id, {
        versao: a.versao,
        para,
        nossoNumero: para === 'guia_emitida' ? (nossoNumero.value[a.id] ?? '') : null,
        dataPagamento: para === 'paga' ? (pagoEm.value[a.id] ?? null) : null,
        valorPago:
          para === 'paga' ? Number((valorPago.value[a.id] ?? String(a.valorTotal)).replace(',', '.')) : null,
      }),
    t('operadoraDeclaracoes.tps.atualizada'),
  );
  if (r) await carregarTps();
}

// ------------------------------------------------------ conferência cadastral ------------------------------------
const competencia = ref('');
const arquivo = ref<File | null>(null);
const conferencias = ref<Conferencia[]>([]);
const conferenciaAberta = ref<number | null>(null);
const divergencias = ref<Divergencia[]>([]);
const tratamento = ref<Record<number, Exclude<Divergencia['correcao'], 'pendente'> | null>>({});
const justificativa = ref<Record<number, string>>({});
const TIPOS = ['nao_localizado_cadastro', 'nao_localizado_ans', 'campo_divergente', 'situacao_divergente'];
const tipoDivergencia = (x: string) =>
  TIPOS.includes(x) ? t(`operadoraDeclaracoes.conferencia.tipos.${x}`) : x;
const correcao = (x: Divergencia['correcao']) => t(`operadoraDeclaracoes.conferencia.correcoes.${x}`);
const opcoesTratamento = (d: Divergencia) =>
  (['corrigir_cadastro', 'retificar_ans', 'corrigida', 'ignorada'] as const)
    .filter((x) => x !== d.correcao)
    .map((x) => ({ valor: x, rotulo: correcao(x) }));
const podeImportar = computed(
  () => operadora.value !== null && /^\d{4}-\d{2}$/.test(competencia.value) && arquivo.value !== null,
);

async function carregarConferencias() {
  if (operadora.value === null) return;
  conferencias.value = (await tentar(() => lerConferencias(operadora.value!))) ?? [];
}
function escolherArquivo(e: Event) {
  arquivo.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function importar() {
  if (!podeImportar.value || !arquivo.value) return;
  const f = arquivo.value;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const r = await tentar(
    () => importarConferencia(operadora.value!, competencia.value, f.name, btoa(bin)),
    t('operadoraDeclaracoes.conferencia.importada'),
  );
  await carregarConferencias();
  if (r) await abrirConferencia(r.id);
}
async function abrirConferencia(id: number) {
  conferenciaAberta.value = id;
  divergencias.value = (await tentar(() => lerDivergencias(id))) ?? [];
}
async function tratar(d: Divergencia) {
  const para = tratamento.value[d.id];
  if (!para) return;
  const r = await tentar(
    () => tratarDivergencia(d.id, d.versao, para, justificativa.value[d.id]?.trim() || null),
    t('operadoraDeclaracoes.conferencia.atualizada'),
  );
  if (r && conferenciaAberta.value !== null) {
    await abrirConferencia(conferenciaAberta.value);
    await carregarConferencias();
  }
}

// ---------------------------------------------------------------- DMED -------------------------------------------
const anoDmed = ref(String(anoAtual - 1));
const cpf = ref('');
const responsavel = ref('');
const ddd = ref('');
const telefone = ref('');
const email = ref('');
const retifica = ref<number | null>(null);
const declaracoes = ref<Declaracao[]>([]);
const recibo = ref<Record<number, string>>({});
const cpfDigitos = computed(() => cpf.value.replace(/\D/g, ''));
const cpfValido = computed(() => {
  const d = cpfDigitos.value;
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (k: number) => {
    let s = 0;
    for (let i = 0; i < k; i++) s += Number(d[i]) * (k + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
});
const entregues = computed(() => [
  { valor: null, rotulo: t('operadoraDeclaracoes.dmed.original') },
  ...declaracoes.value
    .filter(
      (d) =>
        (d.situacao === 'transmitida' || d.situacao === 'aceita') &&
        String(d.anoCalendario) === anoDmed.value,
    )
    .map((d) => ({
      valor: d.id,
      rotulo: t('operadoraDeclaracoes.dmed.retifica', { ano: d.anoCalendario, recibo: d.numeroRecibo ?? '' }),
    })),
]);
const podeGerar = computed(
  () =>
    operadora.value !== null &&
    /^\d{4}$/.test(anoDmed.value) &&
    cpfValido.value &&
    responsavel.value.trim() !== '',
);
const situacaoDmed = (s: Declaracao['situacao']) => t(`operadoraDeclaracoes.dmed.situacoes.${s}`);

async function carregarDmed() {
  if (operadora.value === null) return;
  declaracoes.value = (await tentar(() => lerDeclaracoes(operadora.value!))) ?? [];
}
async function gerar() {
  if (!podeGerar.value) return;
  const r = await tentar(
    () =>
      gerarDmed(operadora.value!, {
        anoCalendario: Number(anoDmed.value),
        retifica: retifica.value,
        responsavelCpf: cpfDigitos.value,
        responsavelNome: responsavel.value.trim(),
        responsavelDdd: ddd.value.trim() || null,
        responsavelTelefone: telefone.value.trim() || null,
        responsavelEmail: email.value.trim() || null,
      }),
    t('operadoraDeclaracoes.dmed.gerada'),
  );
  if (r) await carregarDmed();
}
async function baixar(d: Declaracao) {
  const a = await tentar(() => lerArquivoDmed(d.id));
  if (!a) return;
  const link = document.createElement('a');
  link.href = `data:text/plain;base64,${a.base64}`;
  link.download = a.nome;
  link.click();
}
async function avancar(d: Declaracao, para: 'transmitida' | 'aceita' | 'rejeitada' | 'cancelada') {
  const r = await tentar(
    () =>
      passoDmed(d.id, d.versao, para, para === 'transmitida' ? (recibo.value[d.id]?.trim() ?? null) : null),
    t('operadoraDeclaracoes.dmed.atualizada'),
  );
  if (r) await carregarDmed();
}

watch([operadora, aba], () => {
  if (aba.value === 'tps') void carregarTps();
  else if (aba.value === 'conferencia') void carregarConferencias();
  else void carregarDmed();
});
</script>

<template>
  <section class="declaracoes" data-testid="tela-declaracoes-ans">
    <h1>{{ t('operadoraDeclaracoes.titulo') }}</h1>
    <SanteSelecao
      id="decl-operadora"
      v-model="operadora"
      :rotulo="t('operadoraDeclaracoes.operadora')"
      :opcoes="operadoras"
      data-testid="decl-operadora"
    />
    <nav class="declaracoes__abas" :aria-label="t('operadoraDeclaracoes.abasRotulo')">
      <SanteBotao
        :rotulo="t('operadoraDeclaracoes.abas.tps')"
        :variante="aba === 'tps' ? 'primario' : 'secundario'"
        data-testid="aba-tps"
        @click="aba = 'tps'"
      />
      <SanteBotao
        :rotulo="t('operadoraDeclaracoes.abas.conferencia')"
        :variante="aba === 'conferencia' ? 'primario' : 'secundario'"
        data-testid="aba-conferencia"
        @click="aba = 'conferencia'"
      />
      <SanteBotao
        :rotulo="t('operadoraDeclaracoes.abas.dmed')"
        :variante="aba === 'dmed' ? 'primario' : 'secundario'"
        data-testid="aba-dmed"
        @click="aba = 'dmed'"
      />
    </nav>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="decl-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="decl-aviso" />

    <div v-if="aba === 'tps'" class="declaracoes__painel" data-testid="painel-tps">
      <p class="declaracoes__ajuda">{{ t('operadoraDeclaracoes.tps.ajuda') }}</p>
      <div class="declaracoes__linha">
        <SanteCampoTexto
          :max-bytes="4"
          id="tps-ano"
          v-model="anoTps"
          :rotulo="t('operadoraDeclaracoes.tps.ano')"
          data-testid="tps-ano"
        />
        <SanteSelecao
          id="tps-trimestre"
          v-model="trimestre"
          :rotulo="t('operadoraDeclaracoes.tps.trimestre')"
          :opcoes="trimestres"
          data-testid="tps-trimestre"
        />
        <SanteBotao
          :rotulo="t('operadoraDeclaracoes.tps.apurar')"
          :desabilitado="!podeApurar"
          data-testid="tps-apurar"
          @click="apurar"
        />
      </div>
      <table v-if="ultima" class="declaracoes__tabela" data-testid="tps-conta">
        <caption>
          {{
            t('operadoraDeclaracoes.tps.contaTitulo', { data: dataBr(ultima.apuracao.vencimento) })
          }}
        </caption>
        <tr v-for="p in ultima.apuracao.parcelas" :key="p.plano">
          <td>{{ p.plano }}</td>
          <td>{{ t('operadoraDeclaracoes.tps.media', { n: p.media.toLocaleString('pt-BR') }) }}</td>
          <td>{{ moeda(p.valor) }}</td>
        </tr>
        <tr>
          <th colspan="2">{{ t('operadoraDeclaracoes.tps.total') }}</th>
          <th>{{ moeda(ultima.apuracao.valorTotal) }}</th>
        </tr>
      </table>
      <table class="declaracoes__tabela" data-testid="tps-lista">
        <tr>
          <th>{{ t('operadoraDeclaracoes.tps.colunas.periodo') }}</th>
          <th>{{ t('operadoraDeclaracoes.tps.colunas.vidas') }}</th>
          <th>{{ t('operadoraDeclaracoes.tps.colunas.total') }}</th>
          <th>{{ t('operadoraDeclaracoes.tps.colunas.vencimento') }}</th>
          <th>{{ t('operadoraDeclaracoes.tps.colunas.situacao') }}</th>
          <th>{{ t('operadoraDeclaracoes.tps.colunas.acoes') }}</th>
        </tr>
        <tr v-for="a in apuracoes" :key="a.id" :data-testid="`tps-${a.id}`">
          <td>{{ t('operadoraDeclaracoes.tps.periodo', { t: a.trimestre, a: a.ano }) }}</td>
          <td>{{ a.vidas }}</td>
          <td>{{ moeda(a.valorTotal) }}</td>
          <td>{{ dataBr(a.vencimento) }}</td>
          <td>{{ situacaoTps(a.situacao) }}</td>
          <td class="declaracoes__acoes">
            <template v-if="a.situacao === 'apurada'">
              <SanteCampoTexto
                :max-bytes="50"
                :id="`tps-guia-${a.id}`"
                :model-value="nossoNumero[a.id] ?? ''"
                :rotulo="t('operadoraDeclaracoes.tps.numeroGuia')"
                @update:model-value="(v: string) => (nossoNumero[a.id] = v)"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.tps.guiaEmitida')"
                variante="secundario"
                data-testid="tps-guia"
                @click="passo(a, 'guia_emitida')"
              />
            </template>
            <template v-if="a.situacao === 'apurada' || a.situacao === 'guia_emitida'">
              <SanteCampoTexto
                :max-bytes="10"
                :id="`tps-pago-em-${a.id}`"
                :model-value="pagoEm[a.id] ?? ''"
                :rotulo="t('operadoraDeclaracoes.tps.pagoEm')"
                @update:model-value="(v: string) => (pagoEm[a.id] = v)"
              />
              <SanteCampoTexto
                :max-bytes="16"
                :id="`tps-valor-${a.id}`"
                :model-value="valorPago[a.id] ?? ''"
                :rotulo="t('operadoraDeclaracoes.tps.valorPago')"
                @update:model-value="(v: string) => (valorPago[a.id] = v)"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.tps.registrarPagamento')"
                variante="secundario"
                data-testid="tps-pagar"
                @click="passo(a, 'paga')"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.tps.cancelar')"
                variante="destrutivo"
                :confirmacao="t('operadoraDeclaracoes.tps.confirmarCancelar')"
                @click="passo(a, 'cancelada')"
              />
            </template>
          </td>
        </tr>
      </table>
    </div>

    <div v-else-if="aba === 'conferencia'" class="declaracoes__painel" data-testid="painel-conferencia">
      <p class="declaracoes__ajuda">{{ t('operadoraDeclaracoes.conferencia.ajuda') }}</p>
      <div class="declaracoes__linha">
        <SanteCampoTexto
          :max-bytes="7"
          id="conf-competencia"
          v-model="competencia"
          :rotulo="t('operadoraDeclaracoes.conferencia.competencia')"
          data-testid="conf-competencia"
        />
        <label class="declaracoes__arquivo">
          {{ t('operadoraDeclaracoes.conferencia.arquivo') }}
          <input type="file" accept=".csv,.txt" data-testid="conf-arquivo" @change="escolherArquivo" />
        </label>
        <SanteBotao
          :rotulo="t('operadoraDeclaracoes.conferencia.importar')"
          :desabilitado="!podeImportar"
          data-testid="conf-importar"
          @click="importar"
        />
      </div>
      <table class="declaracoes__tabela" data-testid="conf-lista">
        <tr>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.competencia') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.registros') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.divergencias') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.pendentes') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.situacao') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.acoes') }}</th>
        </tr>
        <tr v-for="k in conferencias" :key="k.id">
          <td>{{ k.competencia }}</td>
          <td>{{ k.registros }}</td>
          <td>{{ k.divergencias }}</td>
          <td>{{ k.pendentes }}</td>
          <td>
            {{
              k.situacao === 'conferida'
                ? t('operadoraDeclaracoes.conferencia.concluida')
                : t('operadoraDeclaracoes.conferencia.emConferencia')
            }}
          </td>
          <td>
            <SanteBotao
              :rotulo="t('operadoraDeclaracoes.conferencia.abrir')"
              variante="texto"
              :data-testid="`conf-abrir-${k.id}`"
              @click="abrirConferencia(k.id)"
            />
          </td>
        </tr>
      </table>
      <table v-if="conferenciaAberta !== null" class="declaracoes__tabela" data-testid="conf-divergencias">
        <tr>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.beneficiario') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.divergencia') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.cadastro') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.ans') }}</th>
          <th>{{ t('operadoraDeclaracoes.conferencia.colunas.tratamento') }}</th>
        </tr>
        <tr v-for="d in divergencias" :key="d.id" :data-testid="`div-${d.sequencia}`">
          <td>
            {{ d.beneficiario ?? t('operadoraDeclaracoes.vazio') }} <small>{{ d.cco }}</small>
          </td>
          <td>
            {{ tipoDivergencia(d.tipo)
            }}<template v-if="d.campo">{{
              t('operadoraDeclaracoes.conferencia.campo', { campo: d.campo })
            }}</template>
          </td>
          <td>{{ d.valorCadastro ?? t('operadoraDeclaracoes.vazio') }}</td>
          <td>{{ d.valorAns ?? t('operadoraDeclaracoes.vazio') }}</td>
          <td class="declaracoes__acoes">
            <span>{{ correcao(d.correcao) }}</span>
            <template v-if="d.correcao !== 'corrigida' && d.correcao !== 'ignorada'">
              <SanteSelecao
                :id="`div-tratar-${d.id}`"
                :model-value="tratamento[d.id] ?? null"
                :rotulo="t('operadoraDeclaracoes.conferencia.encaminhar')"
                :opcoes="opcoesTratamento(d)"
                :data-testid="`div-tratamento-${d.sequencia}`"
                @update:model-value="(v) => (tratamento[d.id] = v)"
              />
              <SanteCampoTexto
                :max-bytes="500"
                v-if="tratamento[d.id] === 'ignorada'"
                :id="`div-just-${d.id}`"
                :model-value="justificativa[d.id] ?? ''"
                :rotulo="t('operadoraDeclaracoes.conferencia.justificativa')"
                obrigatorio
                @update:model-value="(v: string) => (justificativa[d.id] = v)"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.conferencia.aplicar')"
                variante="secundario"
                :desabilitado="
                  !tratamento[d.id] || (tratamento[d.id] === 'ignorada' && !justificativa[d.id]?.trim())
                "
                :data-testid="`div-aplicar-${d.sequencia}`"
                @click="tratar(d)"
              />
            </template>
          </td>
        </tr>
      </table>
    </div>

    <div v-else class="declaracoes__painel" data-testid="painel-dmed">
      <p class="declaracoes__ajuda">{{ t('operadoraDeclaracoes.dmed.ajuda') }}</p>
      <div class="declaracoes__linha">
        <SanteCampoTexto
          :max-bytes="4"
          id="dmed-ano"
          v-model="anoDmed"
          :rotulo="t('operadoraDeclaracoes.dmed.ano')"
          data-testid="dmed-ano"
        />
        <SanteSelecao
          id="dmed-retifica"
          v-model="retifica"
          :rotulo="t('operadoraDeclaracoes.dmed.tipo')"
          :opcoes="entregues"
          data-testid="dmed-retifica"
        />
      </div>
      <div class="declaracoes__linha">
        <SanteCampoTexto
          :max-bytes="14"
          id="dmed-cpf"
          v-model="cpf"
          :rotulo="t('operadoraDeclaracoes.dmed.cpf')"
          obrigatorio
          data-testid="dmed-cpf"
        />
        <SanteCampoTexto
          :max-bytes="150"
          id="dmed-nome"
          v-model="responsavel"
          :rotulo="t('operadoraDeclaracoes.dmed.nome')"
          obrigatorio
          data-testid="dmed-nome"
        />
        <SanteCampoTexto
          :max-bytes="2"
          id="dmed-ddd"
          v-model="ddd"
          :rotulo="t('operadoraDeclaracoes.dmed.ddd')"
        />
        <SanteCampoTexto
          :max-bytes="20"
          id="dmed-telefone"
          v-model="telefone"
          :rotulo="t('operadoraDeclaracoes.dmed.telefone')"
        />
        <SanteCampoTexto
          :max-bytes="254"
          id="dmed-email"
          v-model="email"
          :rotulo="t('operadoraDeclaracoes.dmed.email')"
        />
      </div>
      <p v-if="cpf && !cpfValido" class="declaracoes__erro" data-testid="dmed-cpf-invalido">
        {{ t('operadoraDeclaracoes.dmed.cpfInvalido') }}
      </p>
      <SanteBotao
        :rotulo="t('operadoraDeclaracoes.dmed.gerar')"
        :desabilitado="!podeGerar"
        data-testid="dmed-gerar"
        @click="gerar"
      />
      <table class="declaracoes__tabela" data-testid="dmed-lista">
        <tr>
          <th>{{ t('operadoraDeclaracoes.dmed.colunas.ano') }}</th>
          <th>{{ t('operadoraDeclaracoes.dmed.colunas.prazo') }}</th>
          <th>{{ t('operadoraDeclaracoes.dmed.colunas.pessoas') }}</th>
          <th>{{ t('operadoraDeclaracoes.dmed.colunas.total') }}</th>
          <th>{{ t('operadoraDeclaracoes.dmed.colunas.situacao') }}</th>
          <th>{{ t('operadoraDeclaracoes.dmed.colunas.acoes') }}</th>
        </tr>
        <tr v-for="d in declaracoes" :key="d.id" :data-testid="`dmed-${d.id}`">
          <td>
            {{ d.anoCalendario
            }}<template v-if="d.retificadora">{{ t('operadoraDeclaracoes.dmed.retificadora') }}</template>
          </td>
          <td>{{ dataBr(d.prazo) }}</td>
          <td>{{ d.itens }}</td>
          <td>{{ moeda(d.total) }}</td>
          <td>
            {{ situacaoDmed(d.situacao)
            }}<template v-if="d.numeroRecibo">{{
              t('operadoraDeclaracoes.dmed.recibo', { numero: d.numeroRecibo })
            }}</template>
          </td>
          <td class="declaracoes__acoes">
            <SanteBotao
              v-if="d.arquivo"
              :rotulo="t('operadoraDeclaracoes.dmed.baixar')"
              variante="texto"
              data-testid="dmed-baixar"
              @click="baixar(d)"
            />
            <template v-if="d.situacao === 'gerada'">
              <SanteCampoTexto
                :max-bytes="30"
                :id="`dmed-recibo-${d.id}`"
                :model-value="recibo[d.id] ?? ''"
                :rotulo="t('operadoraDeclaracoes.dmed.reciboEntrega')"
                data-testid="dmed-recibo"
                @update:model-value="(v: string) => (recibo[d.id] = v)"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.dmed.registrarEntrega')"
                variante="secundario"
                :desabilitado="!recibo[d.id]?.trim()"
                data-testid="dmed-entregar"
                @click="avancar(d, 'transmitida')"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.dmed.cancelar')"
                variante="destrutivo"
                :confirmacao="t('operadoraDeclaracoes.dmed.confirmarCancelar')"
                @click="avancar(d, 'cancelada')"
              />
            </template>
            <template v-if="d.situacao === 'transmitida'">
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.dmed.aceita')"
                variante="secundario"
                @click="avancar(d, 'aceita')"
              />
              <SanteBotao
                :rotulo="t('operadoraDeclaracoes.dmed.rejeitada')"
                variante="secundario"
                @click="avancar(d, 'rejeitada')"
              />
            </template>
          </td>
        </tr>
      </table>
    </div>
  </section>
</template>

<style scoped>
.declaracoes {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.declaracoes__abas,
.declaracoes__linha,
.declaracoes__acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.declaracoes__painel {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.declaracoes__ajuda {
  color: var(--sgh-texto-secundario);
}
.declaracoes__erro {
  color: var(--sgh-alerta);
}
.declaracoes__arquivo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.declaracoes__tabela {
  width: 100%;
  border-collapse: collapse;
}
.declaracoes__tabela th,
.declaracoes__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
}
</style>
