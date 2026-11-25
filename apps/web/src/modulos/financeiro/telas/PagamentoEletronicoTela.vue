<script setup lang="ts">
// F3.8, 07-FIN linha 66: `/financeiro/pagar/pagamento-eletronico`. Três trabalhos do pagamento eletrônico numa tela só:
// ler o retorno do banco (o arquivo é conferido na hora, antes de enviar, e cada linha volta com a ocorrência e o que
// foi feito com o título), gerar a remessa por Pix (só entra o credor com chave ativa; quem não tem leva direto ao
// cadastro) e manter a conta e a chave Pix do credor (conferidas a cada tecla pela regra do domínio; o dado gravado
// aparece só com o final). C1-026: o credor da conta é o fornecedor, o profissional ou o prestador terceiro do
// estabelecimento (escolhido antes da busca); quem mantém a conta e a chave (financeiro.contaCredor.manter) não é quem
// gera a remessa (segregação de funções): sem a permissão o botão de gravar fica preso e o motivo aparece escrito, e o
// cadastro de credores vê só a aba dos dados bancários. Fora de produção, o retorno pode vir do simulador: nada sai do estabelecimento.
import {
  conferirContaCredor,
  tipoProvavelChavePix,
  type TipoChavePix,
  type TipoContaCredor,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  type ContaCredorTela,
  gerarRemessaPix,
  TIPOS_CREDOR_CONTA,
  type TipoCredorConta,
  lerBancos,
  lerContasDoCredor,
  lerParcelasPix,
  lerRemessasComPendencia,
  lerRetornos,
  lerRetornoSimulado,
  manterContaCredor,
  processarRetorno,
} from '../api-pagamento-eletronico.js';
import BuscaCredor from '../componentes/BuscaCredor.vue';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const rota = useRoute();
const { apoio, gravacao, pode, motivo, tem } = usarFinanceiro();
type Aba = 'retorno' | 'pix' | 'credor';
const ABAS: readonly Aba[] = ['retorno', 'pix', 'credor'];
// Retorno e Pix pedem a leitura das remessas; a aba do credor, a consulta dos títulos ou a manutenção da conta.
const abasVisiveis = computed(() =>
  ABAS.filter((a) =>
    a === 'credor'
      ? tem('financeiro.tituloPagar.ler') || tem('financeiro.contaCredor.manter')
      : tem('financeiro.remessa.ler'),
  ),
);
const abaPedida = ABAS.includes(rota.query['aba'] as Aba) ? (rota.query['aba'] as Aba) : 'retorno';
const aba = ref<Aba>(
  abasVisiveis.value.includes(abaPedida) ? abaPedida : (abasVisiveis.value[0] ?? abaPedida),
);
watch(abasVisiveis, (v) => {
  const primeira = v[0];
  if (!v.includes(aba.value) && primeira) aba.value = primeira;
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gravar(fn: () => Promise<{ mensagem: string }>, depois: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await depois();
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function trocarAba(a: Aba) {
  aba.value = a;
  erro.value = null;
  mensagem.value = null;
}

// ── Retorno do banco ──
const remessas = useQuery({
  queryKey: ['financeiro', 'pagamento-eletronico', 'remessas'],
  queryFn: () => lerRemessasComPendencia(),
  enabled: computed(() => tem('financeiro.remessa.ler')),
});
const remessa = ref(typeof rota.query['remessa'] === 'string' ? rota.query['remessa'] : '');
const opcoesRemessa = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...[...(remessas.data.value ?? [])]
    .sort((a, b) => Number(b.pendentes > 0) - Number(a.pendentes > 0) || b.id - a.id)
    .map((r) => ({
      valor: String(r.id),
      rotulo: `${r.numero} · ${r.contaNome} · ${reais(r.valor)} · ${
        r.pendentes > 0
          ? t('financeiro.pagamentoEletronico.retorno.aguardando', { n: r.pendentes })
          : t('financeiro.pagamentoEletronico.retorno.respondida')
      }`,
    })),
]);
watch(
  () => remessas.data.value,
  (lista) => {
    // Uma só remessa aguardando o banco: já vem escolhida.
    const pendentes = (lista ?? []).filter((r) => r.pendentes > 0);
    if (!remessa.value && pendentes.length === 1) remessa.value = String(pendentes[0]?.id);
  },
  { immediate: true },
);
const retornos = useQuery({
  queryKey: computed(() => ['financeiro', 'pagamento-eletronico', 'retornos', remessa.value]),
  queryFn: () => lerRetornos(Number(remessa.value)),
  enabled: computed(() => Number(remessa.value) > 0),
});
const arquivo = reactive({ nome: '', conteudo: '' });
/** Conferência na hora, antes de enviar: CNAB 240 de retorno (cada linha com 240 posições, cabeçalho de retorno). */
const conferenciaArquivo = computed(() => {
  if (!arquivo.conteudo) return null;
  const linhas = arquivo.conteudo.split(/\r?\n/).filter((l) => l.length > 0);
  const torta = linhas.findIndex((l) => l.length !== 240);
  if (linhas.length < 2) return { ok: false as const, motivo: 'o arquivo está vazio.' };
  if (torta >= 0) return { ok: false as const, motivo: `a linha ${torta + 1} não tem 240 posições.` };
  if (linhas[0]?.charAt(142) !== '2')
    return { ok: false as const, motivo: 'o cabeçalho não traz o código de retorno.' };
  return {
    ok: true as const,
    linhas: linhas.length,
    titulos: linhas.filter((l) => l.charAt(7) === '3' && l.charAt(13) === 'A').length,
  };
});
async function escolherArquivo(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  arquivo.nome = f?.name ?? '';
  arquivo.conteudo = f ? await f.text() : '';
}
async function usarSimulador() {
  erro.value = null;
  try {
    const r = await lerRetornoSimulado(Number(remessa.value));
    arquivo.nome = r.nomeArquivo;
    arquivo.conteudo = r.conteudo;
  } catch (e) {
    erro.value = e;
  }
}
const enviarRetorno = () =>
  gravar(
    () =>
      processarRetorno(
        { remessa: Number(remessa.value), nomeArquivo: arquivo.nome, conteudo: arquivo.conteudo },
        novaChave('retorno-pagamento'),
      ),
    async () => {
      arquivo.nome = '';
      arquivo.conteudo = '';
      await qc.invalidateQueries({ queryKey: ['financeiro'] });
    },
  );

// ── Remessa por Pix ──
const parcelas = useQuery({
  queryKey: ['financeiro', 'pagamento-eletronico', 'pix'],
  queryFn: () => lerParcelasPix(),
  enabled: computed(() => aba.value === 'pix'),
});
const marcados = reactive(new Set<number>());
const pix = reactive({ conta: '', dataPagamento: new Date().toISOString().slice(0, 10) });
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const totalMarcado = computed(() =>
  (parcelas.data.value ?? []).filter((p) => marcados.has(p.id)).reduce((s, p) => s + p.valor, 0),
);
function alternar(id: number) {
  if (marcados.has(id)) marcados.delete(id);
  else marcados.add(id);
}
const enviarPix = () =>
  gravar(
    () =>
      gerarRemessaPix(
        { conta: Number(pix.conta), parcelas: [...marcados], dataPagamento: pix.dataPagamento },
        novaChave('remessa-pix'),
      ),
    async () => {
      marcados.clear();
      await qc.invalidateQueries({ queryKey: ['financeiro'] });
    },
  );

// ── Dados bancários e chave Pix do credor ──
const tipoCredor = ref<TipoCredorConta>('fornecedor');
const opcoesTipoCredor = computed(() =>
  TIPOS_CREDOR_CONTA.map((v) => ({
    valor: v,
    rotulo: t(`financeiro.pagamentoEletronico.credor.tipos.${v}`),
  })),
);
const podeManterConta = computed(() => tem('financeiro.contaCredor.manter'));
const credor = ref<number | null>(null);
const contasCredor = useQuery({
  queryKey: computed(() => [
    'financeiro',
    'pagamento-eletronico',
    'contas-credor',
    tipoCredor.value,
    credor.value,
  ]),
  queryFn: () => lerContasDoCredor(tipoCredor.value, credor.value ?? 0),
  enabled: computed(() => credor.value !== null),
});
const bancos = useQuery({
  queryKey: ['financeiro', 'pagamento-eletronico', 'bancos'],
  queryFn: () => lerBancos(),
  enabled: computed(() => aba.value === 'credor'),
  staleTime: 3_600_000,
});
const opcoesBanco = computed(() => [
  { valor: '', rotulo: t('financeiro.pagamentoEletronico.credor.semBanco') },
  ...(bancos.data.value ?? []).map((b) => ({ valor: String(b.id), rotulo: b.nome })),
]);
const TIPOS_CONTA: readonly TipoContaCredor[] = ['corrente', 'poupanca', 'pagamento', 'salario'];
const TIPOS_CHAVE: readonly TipoChavePix[] = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];
const opcoesTipoConta = computed(() =>
  TIPOS_CONTA.map((v) => ({ valor: v, rotulo: t(`financeiro.pagamentoEletronico.credor.tiposConta.${v}`) })),
);
const opcoesTipoChave = computed(() => [
  { valor: '', rotulo: t('financeiro.pagamentoEletronico.credor.semChave') },
  ...TIPOS_CHAVE.map((v) => ({
    valor: v,
    rotulo: t(`financeiro.pagamentoEletronico.credor.tiposChave.${v}`),
  })),
]);
const vazio = () => ({
  titularNome: '',
  titularDocumento: '',
  tipoConta: 'corrente' as TipoContaCredor,
  banco: '',
  agencia: '',
  digitoAgencia: '',
  conta: '',
  digitoConta: '',
  tipoChavePix: '' as TipoChavePix | '',
  chavePix: '',
  preferencial: false,
});
const form = reactive(vazio());
const corrigindo = ref<ContaCredorTela | null>(null);
const dados = computed(() => ({
  titularNome: form.titularNome,
  titularDocumento: form.titularDocumento,
  tipoConta: form.tipoConta,
  banco: form.banco ? Number(form.banco) : null,
  agencia: form.agencia,
  digitoAgencia: form.digitoAgencia,
  conta: form.conta,
  digitoConta: form.digitoConta,
  tipoChavePix: form.tipoChavePix || null,
  chavePix: form.chavePix,
}));
const preenchido = computed(() =>
  Boolean(form.titularNome || form.titularDocumento || form.conta || form.chavePix),
);
/** A mesma regra do servidor, a cada tecla: a recusa aparece antes de gravar. */
const recusaConta = computed(() => {
  const r = conferirContaCredor(dados.value);
  return 'codigo' in r ? r.mensagem : null;
});
watch(
  () => form.chavePix,
  (v) => {
    // O tipo da chave é sugerido pela forma digitada; quem escolheu o tipo à mão não é contrariado.
    const tipo = tipoProvavelChavePix(v);
    if (tipo && !form.tipoChavePix) form.tipoChavePix = tipo;
  },
);
function limparForm() {
  Object.assign(form, vazio());
  corrigindo.value = null;
}
watch(credor, limparForm);
function corrigir(c: ContaCredorTela) {
  Object.assign(form, vazio(), {
    titularNome: c.titularNome,
    tipoConta: c.tipoConta,
    banco: c.banco ? String(c.banco) : '',
    preferencial: c.preferencial,
  });
  corrigindo.value = c;
}
const aposConta = async () => {
  limparForm();
  await qc.invalidateQueries({ queryKey: ['financeiro', 'pagamento-eletronico'] });
};
const gravarConta = () =>
  gravar(
    () =>
      manterContaCredor(
        corrigindo.value
          ? {
              acao: 'alterar',
              contaCredor: corrigindo.value.id,
              versao: corrigindo.value.versao,
              ...dados.value,
              preferencial: form.preferencial,
            }
          : {
              acao: 'incluir',
              tipoCredor: tipoCredor.value,
              credor: credor.value ?? 0,
              ...dados.value,
              preferencial: form.preferencial,
            },
        novaChave('conta-credor'),
      ),
    aposConta,
  );
const desativar = (c: ContaCredorTela) =>
  gravar(
    () =>
      manterContaCredor(
        { acao: 'desativar', contaCredor: c.id, versao: c.versao },
        novaChave('conta-credor'),
      ),
    aposConta,
  );
/** Do título sem chave direto ao cadastro, já com o tipo do credor escolhido (a busca começa vazia). */
function cadastrarChave(tipo: 'fornecedor' | 'profissional') {
  tipoCredor.value = tipo;
  trocarAba('credor');
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pe-titulo" data-testid="tela-fin-pagamento-eletronico">
    <h1 id="pe-titulo">{{ t('financeiro.pagamentoEletronico.titulo') }}</h1>
    <p>{{ t('financeiro.pagamentoEletronico.texto') }}</p>
    <p>
      <RouterLink to="/financeiro/pagar/remessas" data-testid="pe-voltar">
        {{ t('financeiro.pagamentoEletronico.voltar') }}
      </RouterLink>
    </p>
    <p
      v-if="gravacao.data.value?.destinoExterno === 'simulador'"
      class="secundario"
      data-testid="pe-simulador"
    >
      {{ t('financeiro.simulador') }}
    </p>
    <div class="filtros" role="group" :aria-label="t('financeiro.pagamentoEletronico.titulo')">
      <button
        v-for="a in abasVisiveis"
        :key="a"
        type="button"
        :aria-pressed="aba === a"
        :data-testid="`pe-aba-${a}`"
        @click="trocarAba(a)"
      >
        {{ t(`financeiro.pagamentoEletronico.abas.${a}`) }}
      </button>
    </div>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="pe-mensagem" />

    <template v-if="aba === 'retorno'">
      <h2>{{ t('financeiro.pagamentoEletronico.abas.retorno') }}</h2>
      <ErroFaturamento v-if="remessas.error.value" :erro="remessas.error.value" />
      <form class="filtros" @submit.prevent="enviarRetorno">
        <span class="campo">
          <SanteSelecao
            v-model="remessa"
            :rotulo="t('financeiro.pagamentoEletronico.retorno.remessa')"
            :opcoes="opcoesRemessa"
            obrigatorio
            data-testid="pe-remessa"
          />
        </span>
        <span class="campo">
          <label for="pe-arquivo">{{ t('financeiro.pagamentoEletronico.retorno.arquivo') }}</label>
          <input
            id="pe-arquivo"
            type="file"
            accept=".ret,.txt,.rem,text/plain"
            data-testid="pe-arquivo"
            @change="escolherArquivo"
          />
        </span>
        <button
          v-if="gravacao.data.value?.destinoExterno === 'simulador'"
          type="button"
          :disabled="!Number(remessa)"
          data-testid="pe-usar-simulador"
          @click="usarSimulador"
        >
          {{ t('financeiro.pagamentoEletronico.retorno.simulador') }}
        </button>
        <button
          type="submit"
          :disabled="gravando || !Number(remessa) || !conferenciaArquivo?.ok"
          data-testid="pe-processar"
        >
          {{ t('financeiro.pagamentoEletronico.retorno.processar') }}
        </button>
      </form>
      <p v-if="conferenciaArquivo?.ok" class="secundario" role="status" data-testid="pe-arquivo-ok">
        {{
          t('financeiro.pagamentoEletronico.retorno.escolhido', {
            nome: arquivo.nome,
            linhas: conferenciaArquivo.linhas,
            titulos: conferenciaArquivo.titulos,
          })
        }}
      </p>
      <p v-else-if="conferenciaArquivo" role="alert" data-testid="pe-arquivo-recusado">
        {{ t('financeiro.pagamentoEletronico.retorno.naoERetorno', { motivo: conferenciaArquivo.motivo }) }}
      </p>
      <template v-if="Number(remessa)">
        <h3>{{ t('financeiro.pagamentoEletronico.retorno.lidos') }}</h3>
        <ErroFaturamento v-if="retornos.error.value" :erro="retornos.error.value" />
        <p v-else-if="!retornos.data.value?.length" data-testid="pe-sem-retorno">
          {{ t('financeiro.pagamentoEletronico.retorno.nenhum') }}
        </p>
        <div v-for="r in retornos.data.value ?? []" :key="r.id" :data-testid="`pe-retorno-${r.id}`">
          <p data-testid="pe-retorno-resumo">
            {{
              t('financeiro.pagamentoEletronico.retorno.resumo', {
                arquivo: r.arquivo,
                baixados: r.baixados,
                rejeitados: r.rejeitados,
                registros: r.registros,
                total: reais(r.totalBaixado),
              })
            }}
          </p>
          <table class="tabela" data-testid="pe-retorno-itens">
            <thead>
              <tr>
                <th scope="col">{{ t('financeiro.pagamentoEletronico.retorno.titulo') }}</th>
                <th scope="col">{{ t('financeiro.credor') }}</th>
                <th scope="col">{{ t('financeiro.pagamentoEletronico.retorno.ocorrencia') }}</th>
                <th scope="col">{{ t('financeiro.pagamentoEletronico.retorno.situacao') }}</th>
                <th scope="col">{{ t('financeiro.pagamentoEletronico.retorno.data') }}</th>
                <th scope="col">{{ t('financeiro.pagamentoEletronico.retorno.enviado') }}</th>
                <th scope="col">{{ t('financeiro.pagamentoEletronico.retorno.efetivado') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in r.itens" :key="i.sequencia" :data-situacao="i.situacao">
                <td>{{ i.documento || t('financeiro.pagamentoEletronico.retorno.foraDaRemessa') }}</td>
                <td>{{ i.credor }}</td>
                <td>
                  {{ i.ocorrencia }} — {{ i.descricao
                  }}<template v-if="i.complementares"> ({{ i.complementares }})</template>
                </td>
                <td>{{ t(`financeiro.pagamentoEletronico.retorno.situacoes.${i.situacao}`) }}</td>
                <td>{{ i.dataPagamento ? data(i.dataPagamento) : '' }}</td>
                <td>{{ i.valorEnviado === null ? '' : reais(i.valorEnviado) }}</td>
                <td>{{ i.valorEfetivado === null ? '' : reais(i.valorEfetivado) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <template v-else-if="aba === 'pix'">
      <h2>{{ t('financeiro.pagamentoEletronico.abas.pix') }}</h2>
      <p>{{ t('financeiro.pagamentoEletronico.pix.texto') }}</p>
      <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
      <table v-else-if="parcelas.data.value?.length" class="tabela" data-testid="pe-pix-parcelas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.marcar') }}</th>
            <th scope="col">{{ t('financeiro.credor') }}</th>
            <th scope="col">{{ t('financeiro.documento') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in parcelas.data.value" :key="p.id">
            <td>
              <input
                v-if="p.temChavePix"
                type="checkbox"
                :checked="marcados.has(p.id)"
                :aria-label="`${t('financeiro.marcar')} ${p.documento}/${p.parcela}`"
                :data-testid="`pe-pix-marcar-${p.documento}`"
                @change="alternar(p.id)"
              />
              <button
                v-else
                type="button"
                :data-testid="`pe-pix-sem-chave-${p.documento}`"
                @click="cadastrarChave(p.credorTipo)"
              >
                {{ t('financeiro.pagamentoEletronico.pix.cadastrar') }}
              </button>
            </td>
            <td>
              {{ p.credorNome }}
              <small class="secundario" :data-testid="`pe-pix-tipo-${p.documento}`">
                · {{ t(`financeiro.pagamentoEletronico.credor.tipos.${p.credorTipo}`) }}
              </small>
              <small v-if="!p.temChavePix" class="secundario">
                ({{ t('financeiro.pagamentoEletronico.pix.semChave') }})
              </small>
            </td>
            <td>{{ p.documento }}/{{ p.parcela }}</td>
            <td>{{ p.vencimento ? data(p.vencimento) : '' }}</td>
            <td>{{ reais(p.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="pe-pix-nenhuma">{{ t('financeiro.pagamentoEletronico.pix.nenhuma') }}</p>
      <form class="filtros" @submit.prevent="enviarPix">
        <span class="campo">
          <SanteSelecao
            v-model="pix.conta"
            :rotulo="t('financeiro.conta')"
            :opcoes="contas"
            obrigatorio
            data-testid="pe-pix-conta"
          />
        </span>
        <span class="campo">
          <label for="pe-pix-data">{{ t('financeiro.pagamentoEletronico.pix.dataPagamento') }}</label>
          <input
            id="pe-pix-data"
            v-model="pix.dataPagamento"
            type="date"
            required
            data-testid="pe-pix-data"
          />
        </span>
        <button
          type="submit"
          :disabled="
            gravando || marcados.size === 0 || !pix.conta || !pix.dataPagamento || !pode('gerarRemessa')
          "
          data-testid="pe-pix-gerar"
        >
          {{ t('financeiro.pagamentoEletronico.pix.gerar') }}
        </button>
      </form>
      <p role="status" data-testid="pe-pix-total">
        {{ t('financeiro.pagamentoEletronico.pix.total', { n: marcados.size, total: reais(totalMarcado) }) }}
      </p>
      <p v-if="!pode('gerarRemessa')" class="secundario">{{ motivo('gerarRemessa') }}</p>
    </template>

    <template v-else>
      <h2>{{ t('financeiro.pagamentoEletronico.abas.credor') }}</h2>
      <div class="filtros">
        <span class="campo">
          <SanteSelecao
            v-model="tipoCredor"
            :rotulo="t('financeiro.pagamentoEletronico.credor.tipo')"
            :opcoes="opcoesTipoCredor"
            obrigatorio
            data-testid="pe-credor-tipo"
          />
        </span>
        <BuscaCredor
          v-model="credor"
          :tipo="tipoCredor"
          :rotulo="t('financeiro.pagamentoEletronico.credor.buscar')"
          prefixo="pe-credor"
        />
      </div>
      <template v-if="credor !== null">
        <h3>{{ t('financeiro.pagamentoEletronico.credor.contas') }}</h3>
        <p class="secundario">{{ t('financeiro.pagamentoEletronico.credor.mascarado') }}</p>
        <ErroFaturamento v-if="contasCredor.error.value" :erro="contasCredor.error.value" />
        <table v-else-if="contasCredor.data.value?.length" class="tabela" data-testid="pe-contas">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.pagamentoEletronico.credor.titular') }}</th>
              <th scope="col">{{ t('financeiro.pagamentoEletronico.credor.banco') }}</th>
              <th scope="col">{{ t('financeiro.pagamentoEletronico.credor.agencia') }}</th>
              <th scope="col">{{ t('financeiro.pagamentoEletronico.credor.conta') }}</th>
              <th scope="col">{{ t('financeiro.pagamentoEletronico.credor.chave') }}</th>
              <th scope="col">{{ t('financeiro.situacao') }}</th>
              <th scope="col">{{ t('financeiro.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in contasCredor.data.value" :key="c.id" :data-testid="`pe-conta-${c.id}`">
              <td>{{ c.titularNome }} ({{ c.titularDocumento }})</td>
              <td>{{ c.bancoNome || t('financeiro.pagamentoEletronico.credor.semBanco') }}</td>
              <td>{{ c.agencia }}</td>
              <td>{{ c.conta }}</td>
              <td>
                <template v-if="c.tipoChavePix">
                  {{ t(`financeiro.pagamentoEletronico.credor.tiposChave.${c.tipoChavePix}`) }}
                  {{ c.chavePix }}
                </template>
                <small v-if="c.chavesNoHistorico > 1" class="secundario">
                  {{ t('financeiro.pagamentoEletronico.credor.historico', { n: c.chavesNoHistorico }) }}
                </small>
              </td>
              <td>
                {{
                  !c.ativo
                    ? t('financeiro.pagamentoEletronico.credor.desativada')
                    : c.preferencial
                      ? t('financeiro.pagamentoEletronico.credor.marcaPreferencial')
                      : ''
                }}
              </td>
              <td>
                <template v-if="c.ativo">
                  <button
                    type="button"
                    :disabled="gravando || !podeManterConta"
                    data-testid="pe-conta-corrigir"
                    @click="corrigir(c)"
                  >
                    {{ t('financeiro.pagamentoEletronico.credor.corrigir') }}
                  </button>
                  <button
                    type="button"
                    :disabled="gravando || !podeManterConta"
                    data-testid="pe-conta-desativar"
                    @click="desativar(c)"
                  >
                    {{ t('financeiro.pagamentoEletronico.credor.desativar') }}
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else data-testid="pe-contas-nenhuma">{{ t('financeiro.pagamentoEletronico.credor.nenhuma') }}</p>

        <h3>
          {{
            corrigindo
              ? t('financeiro.pagamentoEletronico.credor.corrigindo', { titular: corrigindo.titularNome })
              : t('financeiro.pagamentoEletronico.credor.nova')
          }}
        </h3>
        <form class="filtros" @submit.prevent="gravarConta">
          <span class="campo">
            <label for="pe-titular">{{ t('financeiro.pagamentoEletronico.credor.titular') }}</label>
            <input
              id="pe-titular"
              v-model="form.titularNome"
              maxlength="150"
              required
              data-testid="pe-titular"
            />
          </span>
          <span class="campo">
            <label for="pe-documento">{{ t('financeiro.pagamentoEletronico.credor.documento') }}</label>
            <input
              id="pe-documento"
              v-model="form.titularDocumento"
              maxlength="18"
              inputmode="numeric"
              required
              data-testid="pe-documento"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="form.banco"
              :rotulo="t('financeiro.pagamentoEletronico.credor.banco')"
              :opcoes="opcoesBanco"
              data-testid="pe-banco"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="form.tipoConta"
              :rotulo="t('financeiro.pagamentoEletronico.credor.tipoConta')"
              :opcoes="opcoesTipoConta"
              data-testid="pe-tipo-conta"
            />
          </span>
          <span class="campo">
            <label for="pe-agencia">{{ t('financeiro.pagamentoEletronico.credor.agencia') }}</label>
            <input
              id="pe-agencia"
              v-model="form.agencia"
              maxlength="10"
              inputmode="numeric"
              data-testid="pe-agencia"
            />
          </span>
          <span class="campo">
            <label for="pe-digito-agencia">
              {{ t('financeiro.pagamentoEletronico.credor.digito') }} ({{
                t('financeiro.pagamentoEletronico.credor.agencia')
              }})
            </label>
            <input
              id="pe-digito-agencia"
              v-model="form.digitoAgencia"
              maxlength="2"
              data-testid="pe-digito-agencia"
            />
          </span>
          <span class="campo">
            <label for="pe-conta">{{ t('financeiro.pagamentoEletronico.credor.conta') }}</label>
            <input
              id="pe-conta"
              v-model="form.conta"
              maxlength="20"
              inputmode="numeric"
              data-testid="pe-conta"
            />
          </span>
          <span class="campo">
            <label for="pe-digito-conta">
              {{ t('financeiro.pagamentoEletronico.credor.digito') }} ({{
                t('financeiro.pagamentoEletronico.credor.conta')
              }})
            </label>
            <input
              id="pe-digito-conta"
              v-model="form.digitoConta"
              maxlength="2"
              data-testid="pe-digito-conta"
            />
          </span>
          <span class="campo">
            <label for="pe-chave">{{ t('financeiro.pagamentoEletronico.credor.chave') }}</label>
            <input
              id="pe-chave"
              v-model="form.chavePix"
              maxlength="100"
              autocomplete="off"
              data-testid="pe-chave"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="form.tipoChavePix"
              :rotulo="t('financeiro.pagamentoEletronico.credor.tipoChave')"
              :opcoes="opcoesTipoChave"
              data-testid="pe-tipo-chave"
            />
          </span>
          <span class="campo">
            <label for="pe-preferencial">
              <input
                id="pe-preferencial"
                v-model="form.preferencial"
                type="checkbox"
                data-testid="pe-preferencial"
              />
              {{ t('financeiro.pagamentoEletronico.credor.preferencial') }}
            </label>
          </span>
          <button
            type="submit"
            :disabled="gravando || recusaConta !== null || !podeManterConta"
            data-testid="pe-gravar-conta"
          >
            {{ t('financeiro.pagamentoEletronico.credor.gravar') }}
          </button>
          <button v-if="corrigindo" type="button" data-testid="pe-cancelar-correcao" @click="limparForm">
            {{ t('financeiro.pagamentoEletronico.credor.cancelar') }}
          </button>
        </form>
        <p v-if="preenchido && recusaConta" role="alert" data-testid="pe-recusa-conta">{{ recusaConta }}</p>
        <p v-if="!podeManterConta" class="secundario" role="status" data-testid="pe-sem-permissao-conta">
          {{ t('financeiro.pagamentoEletronico.credor.semPermissao') }}
        </p>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
