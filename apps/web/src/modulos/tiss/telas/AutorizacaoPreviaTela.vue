<script setup lang="ts">
// Autorização prévia à operadora (C2-081, 06-FAT L27): `/faturamento/autorizacoes?paciente=`, aberta pela recepção e
// pela internação. Visão por paciente: as coberturas ativas, o pedido novo nascido da carteira (nada redigitado),
// conferido na hora pelas regras do domínio (o que falta por tipo, CID da internação, itens, OPME) com o botão
// habilitado só quando a regra aceita, e os pedidos com o próximo passo de cada um em um clique: enviar (a guia
// eletrônica de SP/SADT, internação e prorrogação é validada e guardada), registrar o canal real da entrega, consultar o
// andamento, registrar a resposta por item, cobrir os itens da conta e cancelar com o motivo. Nada se apaga.
import {
  conferirDiagnosticosAutorizacao,
  conferirPedidoAutorizacao,
  lerRespostaAutorizacao,
  TIPOS_COM_MENSAGEM,
  type TipoSolicitacaoAutorizacao,
} from '@sgh/dominio-faturamento';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  type AutorizacoesDoPaciente,
  cancelarPedidoAutorizacao,
  consultarAndamentoAutorizacao,
  criarPedidoAutorizacao,
  enviarPedidoAutorizacao,
  lerAutorizacoesDoPaciente,
  ligarAutorizacaoNaConta,
  type PedidoAutorizacaoTela,
  registrarTransmissaoAutorizacao,
  responderPedidoAutorizacao,
} from '../api-autorizacao-previa.js';

const { t } = useI18n();
const k = (c: string, p: Record<string, unknown> = {}) => t(`autorizacaoPrevia.${c}`, p);
const rota = useRoute();
const roteador = useRouter();

const pacienteTexto = ref(String(Number(rota.query['paciente']) || ''));
const paciente = ref<number | null>(null);
const dados = ref<AutorizacoesDoPaciente | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);

const TIPOS = ['sp_sadt', 'internacao', 'prorrogacao', 'quimioterapia', 'radioterapia', 'opme'] as const;
const CANAIS = ['webservice', 'portal', 'telefone', 'email', 'presencial'] as const;
const opTipos = TIPOS.map((x) => ({ valor: x, rotulo: k(`tipos.${x}`) }));
const opRegimes = (['hospitalar', 'hospital_dia', 'domiciliar'] as const).map((x) => ({
  valor: x,
  rotulo: k(`regimes.${x}`),
}));
const opSimNao = [
  { valor: 'nao', rotulo: k('nao') },
  { valor: 'sim', rotulo: k('sim') },
];
const opEntrega = (['portal', 'email', 'telefone', 'presencial'] as const).map((x) => ({
  valor: x,
  rotulo: k(`canais.${x}`),
}));

interface ItemForm {
  codigoTabela: string;
  codigoProcedimento: string;
  descricao: string;
  quantidade: string;
  itemFaturavel: string;
  opme: 'sim' | 'nao';
  registroAnvisa: string;
}
const itemVazio = (): ItemForm => ({
  codigoTabela: '22',
  codigoProcedimento: '',
  descricao: '',
  quantidade: '1',
  itemFaturavel: '',
  opme: 'nao',
  registroAnvisa: '',
});
const form = reactive({
  tipo: 'sp_sadt' as TipoSolicitacaoAutorizacao,
  cobertura: null as number | null,
  canal: 'webservice' as (typeof CANAIS)[number],
  principal: null as number | null,
  conta: '',
  solicitante: '',
  regime: 'hospitalar' as 'hospitalar' | 'hospital_dia' | 'domiciliar',
  diarias: '',
  dataAdmissao: '',
  indicacaoClinica: '',
  cids: [''] as string[],
  itens: [itemVazio()] as ItemForm[],
});
const usaInternacao = computed(() => form.tipo === 'internacao');
const usaDiarias = computed(() => form.tipo === 'internacao' || form.tipo === 'prorrogacao');
const opCanais = computed(() =>
  CANAIS.filter((c) => c !== 'webservice' || TIPOS_COM_MENSAGEM.includes(form.tipo)).map((x) => ({
    valor: x,
    rotulo: k(`canais.${x}`),
  })),
);
const opCoberturas = computed(() =>
  (dados.value?.coberturas ?? []).map((c) => ({
    valor: c.id,
    rotulo: `${c.fontePagadora} · ${c.carteira ?? ''}`,
  })),
);
const opPrincipais = computed(() => [
  { valor: null, rotulo: k('semPrincipal') },
  ...(dados.value?.pedidos ?? [])
    .filter((p) => p.tipo === 'internacao' || p.tipo === 'sp_sadt')
    .map((p) => ({ valor: p.id, rotulo: `${p.numero} · ${k(`tipos.${p.tipo}`)}` })),
]);
const inteiro = (s: string) => {
  const n = Number(s.trim());
  return s.trim() && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const hoje = () => new Date().toISOString().slice(0, 10);

const itensDoForm = () =>
  form.itens.map((i) => ({
    codigoTabela: i.codigoTabela.trim(),
    codigoProcedimento: i.codigoProcedimento.trim(),
    descricao: i.descricao.trim(),
    quantidade: Number(i.quantidade),
    valorUnitario: null,
    opme: i.opme === 'sim',
    registroAnvisa: i.registroAnvisa.trim() || null,
    fabricante: null,
    itemFaturavel: inteiro(i.itemFaturavel),
  }));
const diagnosticosDoForm = () =>
  form.cids
    .map((c) => c.trim())
    .filter(Boolean)
    .map((cid) => ({ cid, tipoDoenca: null, tempo: null, unidadeTempo: null }));

/** O que falta no pedido, pelas mesmas regras que o servidor aplica (validação na hora). */
const faltasPedido = computed(() => {
  const cob = dados.value?.coberturas.find((c) => c.id === form.cobertura);
  const r = cob
    ? conferirPedidoAutorizacao({
        tipo: form.tipo,
        canal: form.canal,
        carteira: cob.carteira ?? '',
        validadeCarteira: cob.validade ? cob.validade.slice(0, 10) : null,
        hoje: hoje(),
        ligado: form.principal !== null,
        temSolicitante: inteiro(form.solicitante) !== null,
        regimeInternacao: usaInternacao.value ? form.regime : null,
        diarias: usaDiarias.value ? inteiro(form.diarias) : null,
        indicacaoClinica: form.indicacaoClinica.trim() || null,
        itens: itensDoForm(),
      }).map((p) => p.mensagem)
    : [k('cobertura')];
  return [...r, ...conferirDiagnosticosAutorizacao(form.tipo, diagnosticosDoForm()).map((p) => p.mensagem)];
});

async function tentar(fn: () => Promise<string | null>): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    aviso.value = await fn();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}
const respostas = reactive<
  Record<number, { senha: string; guia: string; qtd: Record<number, string>; motivo: Record<number, string> }>
>({});
const entregas = reactive<Record<number, string>>({});
const cancelamentos = reactive<Record<number, string>>({});
async function recarregar(): Promise<void> {
  if (!paciente.value) return;
  dados.value = await lerAutorizacoesDoPaciente(paciente.value);
  form.cobertura ??= dados.value.coberturas[0]?.id ?? null;
  for (const p of dados.value.pedidos) {
    respostas[p.id] ??= {
      senha: '',
      guia: '',
      qtd: Object.fromEntries(p.itens.map((i) => [i.sequencia, String(i.quantidade)])),
      // O campo do motivo aparece na negativa e exige texto (nunca undefined), senão a linha não se desenha.
      motivo: Object.fromEntries(p.itens.map((i) => [i.sequencia, ''])),
    };
    entregas[p.id] ??= 'portal';
    cancelamentos[p.id] ??= '';
  }
}
const abrir = () =>
  tentar(async () => {
    paciente.value = inteiro(pacienteTexto.value);
    dados.value = null;
    if (paciente.value)
      await roteador.replace({ query: { ...rota.query, paciente: String(paciente.value) } });
    await recarregar();
    return null;
  });

const criar = () =>
  tentar(async () => {
    const r = await criarPedidoAutorizacao({
      tipo: form.tipo,
      cobertura: form.cobertura,
      canal: form.canal,
      principal: form.principal,
      conta: inteiro(form.conta),
      solicitanteProfissional: inteiro(form.solicitante),
      regime: usaInternacao.value ? form.regime : null,
      diarias: usaDiarias.value ? inteiro(form.diarias) : null,
      dataAdmissao: usaInternacao.value && form.dataAdmissao ? form.dataAdmissao : null,
      indicacaoClinica: form.indicacaoClinica.trim() || null,
      diagnosticos: diagnosticosDoForm(),
      itens: itensDoForm(),
    });
    form.itens = [itemVazio()];
    form.cids = [''];
    await recarregar();
    return k('criado', { numero: r.numero });
  });

const corpoResposta = (p: PedidoAutorizacaoTela) => {
  const r = respostas[p.id]!;
  return {
    senha: r.senha.trim() || null,
    numeroGuiaOperadora: r.guia.trim() || null,
    dataAutorizacao: null,
    senhaValidade: null,
    situacao: null,
    itens: p.itens.map((i) => ({
      sequencia: i.sequencia,
      quantidadeAutorizada: Number(r.qtd[i.sequencia] ?? 0),
      valorAutorizado: null,
      motivoNegativa: r.motivo[i.sequencia]?.trim() || null,
      motivoGlosa: null,
    })),
  };
};
const faltasResposta = (p: PedidoAutorizacaoTela) =>
  lerRespostaAutorizacao(
    p.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantidade })),
    corpoResposta(p),
  ).problemas.map((x) => x.mensagem);

const acao = (fn: () => Promise<unknown>, msg: (r: unknown) => string) =>
  tentar(async () => {
    const r = await fn();
    await recarregar();
    return msg(r);
  });
const enviar = (p: PedidoAutorizacaoTela) =>
  acao(
    () => enviarPedidoAutorizacao(p.id, p.versao),
    (r) => ((r as { situacao?: string }).situacao === 'pronta_envio' ? k('guiaPronta') : k('enviado')),
  );
const transmitir = (p: PedidoAutorizacaoTela) =>
  acao(
    () => registrarTransmissaoAutorizacao(p.id, p.versao, entregas[p.id]!),
    () => k('transmitida'),
  );
const andamento = (p: PedidoAutorizacaoTela) =>
  acao(
    () => consultarAndamentoAutorizacao(p.id),
    () => k('andamentoRegistrado'),
  );
const responder = (p: PedidoAutorizacaoTela) =>
  acao(
    () => {
      const b = corpoResposta(p);
      return responderPedidoAutorizacao(p.id, {
        senha: b.senha,
        numeroGuiaOperadora: b.numeroGuiaOperadora,
        itens: b.itens.map((i) => ({
          sequencia: i.sequencia,
          quantidadeAutorizada: i.quantidadeAutorizada,
          motivoNegativa: i.motivoNegativa,
        })),
        versao: p.versao,
      });
    },
    () => k('respondida'),
  );
const ligar = (p: PedidoAutorizacaoTela) =>
  acao(
    () => ligarAutorizacaoNaConta(p.id),
    (r) => {
      const x = r as { ligados: number; semCobertura: number };
      return k('ligada', { n: x.ligados, s: x.semCobertura });
    },
  );
const cancelar = (p: PedidoAutorizacaoTela) =>
  acao(
    () => cancelarPedidoAutorizacao(p.id, p.versao, cancelamentos[p.id]!.trim()),
    () => k('cancelado'),
  );

const ehResposta = (s: string) => s === 'enviada' || s === 'em_analise';
const autorizada = (s: string) => s === 'autorizada' || s === 'autorizada_parcial';
const cancelavel = (s: string) => !['negada', 'cancelada'].includes(s);

if (pacienteTexto.value) void abrir();
</script>

<template>
  <section class="autorizacao" data-testid="autorizacao-previa" aria-labelledby="aut-titulo">
    <h1 id="aut-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <form class="linha" @submit.prevent="abrir">
      <SanteCampoTexto
        v-model="pacienteTexto"
        :rotulo="k('paciente')"
        :max-bytes="12"
        data-testid="aut-paciente"
      />
      <SanteBotao tipo="submit" variante="secundario" :rotulo="k('abrir')" data-testid="aut-abrir" />
    </form>
    <p v-if="erro" role="alert" class="erro" data-testid="aut-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="aut-aviso">{{ aviso }}</p>

    <template v-if="dados">
      <p v-if="!dados.coberturas.length">{{ k('nenhumaCobertura') }}</p>
      <form v-else class="novo" data-testid="aut-novo" @submit.prevent="criar">
        <h2>{{ k('novo') }}</h2>
        <div class="linha">
          <SanteSelecao v-model="form.tipo" :rotulo="k('tipo')" :opcoes="opTipos" data-testid="aut-tipo" />
          <SanteSelecao
            v-model="form.cobertura"
            :rotulo="k('cobertura')"
            :opcoes="opCoberturas"
            data-testid="aut-cobertura"
          />
          <SanteSelecao
            v-model="form.canal"
            :rotulo="k('canal')"
            :opcoes="opCanais"
            data-testid="aut-canal"
          />
          <SanteSelecao
            v-model="form.principal"
            :rotulo="k('principal')"
            :opcoes="opPrincipais"
            data-testid="aut-principal"
          />
        </div>
        <div class="linha">
          <SanteCampoTexto
            v-model="form.solicitante"
            :rotulo="k('solicitante')"
            :max-bytes="12"
            data-testid="aut-solicitante"
          />
          <SanteCampoTexto
            v-model="form.conta"
            :rotulo="k('conta')"
            :max-bytes="12"
            data-testid="aut-conta"
          />
          <SanteSelecao
            v-if="usaInternacao"
            v-model="form.regime"
            :rotulo="k('regime')"
            :opcoes="opRegimes"
            data-testid="aut-regime"
          />
          <SanteCampoTexto
            v-if="usaDiarias"
            v-model="form.diarias"
            :rotulo="k('diarias')"
            :max-bytes="2"
            data-testid="aut-diarias"
          />
          <SanteCampoTexto
            v-if="usaInternacao"
            v-model="form.dataAdmissao"
            :rotulo="k('dataAdmissao')"
            :max-bytes="10"
            data-testid="aut-admissao"
          />
        </div>
        <SanteCampoTexto
          v-model="form.indicacaoClinica"
          :rotulo="k('indicacaoClinica')"
          :max-bytes="1000"
          data-testid="aut-indicacao"
        />
        <fieldset data-testid="aut-diagnosticos">
          <legend>{{ k('diagnosticos') }}</legend>
          <div class="linha">
            <SanteCampoTexto
              v-for="(_, n) in form.cids"
              :key="n"
              v-model="form.cids[n]!"
              :rotulo="`${k('cid')} ${n + 1}`"
              :max-bytes="6"
              :data-testid="`aut-cid-${n}`"
            />
            <SanteBotao
              v-if="form.cids.length < 4"
              variante="secundario"
              :rotulo="k('maisCid')"
              data-testid="aut-mais-cid"
              @acionar="form.cids.push('')"
            />
          </div>
        </fieldset>
        <fieldset data-testid="aut-itens">
          <legend>{{ k('itens') }}</legend>
          <div v-for="(i, n) in form.itens" :key="n" class="linha" :data-testid="`aut-item-${n}`">
            <SanteCampoTexto
              v-model="i.codigoTabela"
              :rotulo="k('codigoTabela')"
              :max-bytes="2"
              data-testid="aut-item-tabela"
            />
            <SanteCampoTexto
              v-model="i.codigoProcedimento"
              :rotulo="k('codigoProcedimento')"
              :max-bytes="10"
              data-testid="aut-item-codigo"
            />
            <SanteCampoTexto
              v-model="i.descricao"
              :rotulo="k('descricao')"
              :max-bytes="150"
              data-testid="aut-item-descricao"
            />
            <SanteCampoTexto
              v-model="i.quantidade"
              :rotulo="k('quantidade')"
              :max-bytes="3"
              data-testid="aut-item-quantidade"
            />
            <SanteCampoTexto
              v-model="i.itemFaturavel"
              :rotulo="k('itemFaturavel')"
              :max-bytes="12"
              data-testid="aut-item-faturavel"
            />
            <SanteSelecao
              v-model="i.opme"
              :rotulo="k('opme')"
              :opcoes="opSimNao"
              data-testid="aut-item-opme"
            />
            <SanteCampoTexto
              v-if="i.opme === 'sim'"
              v-model="i.registroAnvisa"
              :rotulo="k('registroAnvisa')"
              :max-bytes="15"
              data-testid="aut-item-anvisa"
            />
            <SanteBotao
              v-if="form.itens.length > 1"
              variante="secundario"
              :rotulo="k('remover')"
              @acionar="form.itens.splice(n, 1)"
            />
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="k('maisItem')"
            data-testid="aut-mais-item"
            @acionar="form.itens.push(itemVazio())"
          />
        </fieldset>
        <ul v-if="faltasPedido.length" class="erro" data-testid="aut-falta">
          <li v-for="m in faltasPedido" :key="m">{{ m }}</li>
        </ul>
        <SanteBotao
          tipo="submit"
          :rotulo="k('criar')"
          :desabilitado="faltasPedido.length > 0"
          data-testid="aut-criar"
        />
      </form>

      <h2>{{ k('pedidos') }}</h2>
      <p v-if="!dados.pedidos.length">{{ k('nenhumPedido') }}</p>
      <table v-else data-testid="aut-pedidos">
        <thead>
          <tr>
            <th
              v-for="c in ['numero', 'tipo', 'convenio', 'situacao', 'resposta', 'acoes']"
              :key="c"
              scope="col"
            >
              {{ k(`colunas.${c}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in dados.pedidos" :key="p.id" :data-testid="`aut-pedido-${p.id}`">
            <td>
              {{ p.numero }}
              <span v-if="p.diagnosticos.length" class="cids">{{
                p.diagnosticos.map((d) => d.cid).join(', ')
              }}</span>
            </td>
            <td>{{ k(`tipos.${p.tipo}`) }} · {{ k(`canais.${p.canal}`) }}</td>
            <td>{{ p.fontePagadora }} · {{ p.carteira }}</td>
            <td data-testid="aut-situacao">{{ k(`situacoes.${p.situacao}`) }}</td>
            <td>
              <template v-if="p.respostas[0]">
                {{ [p.respostas[0].senha, p.respostas[0].numeroGuiaOperadora].filter(Boolean).join(' · ') }}
              </template>
              <span v-if="p.itensDaContaCobertos" data-testid="aut-cobertos">
                {{ k('cobertos', { n: p.itensDaContaCobertos }) }}
              </span>
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="p.situacao === 'rascunho' || p.situacao === 'erro_envio'"
                :rotulo="k('enviar')"
                data-testid="aut-enviar"
                @acionar="enviar(p)"
              />
              <a v-if="p.xmlGuardado" :href="`/api/tiss/autorizacoes/${p.id}/xml`" data-testid="aut-xml">{{
                k('verXml')
              }}</a>
              <div v-if="p.situacao === 'pronta_envio'" class="linha">
                <SanteSelecao
                  v-model="entregas[p.id]!"
                  :rotulo="k('transmitidaPor')"
                  :opcoes="opEntrega"
                  data-testid="aut-entrega"
                />
                <SanteBotao
                  :rotulo="k('registrarTransmissao')"
                  data-testid="aut-transmitir"
                  @acionar="transmitir(p)"
                />
              </div>
              <div
                v-if="ehResposta(p.situacao) && respostas[p.id]"
                class="resposta"
                data-testid="aut-resposta"
              >
                <SanteBotao
                  variante="secundario"
                  :rotulo="k('andamento')"
                  data-testid="aut-andamento"
                  @acionar="andamento(p)"
                />
                <div class="linha">
                  <SanteCampoTexto
                    v-model="respostas[p.id]!.senha"
                    :rotulo="k('senha')"
                    :max-bytes="20"
                    data-testid="aut-senha"
                  />
                  <SanteCampoTexto
                    v-model="respostas[p.id]!.guia"
                    :rotulo="k('numeroGuiaOperadora')"
                    :max-bytes="20"
                    data-testid="aut-guia-operadora"
                  />
                </div>
                <div v-for="i in p.itens" :key="i.sequencia" class="linha">
                  <SanteCampoTexto
                    v-model="respostas[p.id]!.qtd[i.sequencia]!"
                    :rotulo="k('autorizada', { seq: i.sequencia })"
                    :max-bytes="3"
                    :data-testid="`aut-qtd-${i.sequencia}`"
                  />
                  <SanteCampoTexto
                    v-if="Number(respostas[p.id]!.qtd[i.sequencia]) === 0"
                    v-model="respostas[p.id]!.motivo[i.sequencia]!"
                    :rotulo="k('motivo', { seq: i.sequencia })"
                    :max-bytes="1000"
                    :data-testid="`aut-motivo-${i.sequencia}`"
                  />
                </div>
                <ul v-if="faltasResposta(p).length" class="erro" data-testid="aut-falta-resposta">
                  <li v-for="m in faltasResposta(p)" :key="m">{{ m }}</li>
                </ul>
                <SanteBotao
                  :rotulo="k('registrarResposta')"
                  :desabilitado="faltasResposta(p).length > 0"
                  data-testid="aut-responder"
                  @acionar="responder(p)"
                />
              </div>
              <SanteBotao
                v-if="autorizada(p.situacao) && p.conta !== null"
                variante="secundario"
                :rotulo="k('ligarConta')"
                data-testid="aut-ligar-conta"
                @acionar="ligar(p)"
              />
              <div v-if="cancelavel(p.situacao)" class="linha">
                <SanteCampoTexto
                  v-model="cancelamentos[p.id]!"
                  :rotulo="k('motivoCancelamento')"
                  :max-bytes="300"
                  data-testid="aut-motivo-cancelamento"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="k('cancelar')"
                  :desabilitado="(cancelamentos[p.id] ?? '').trim().length < 3"
                  data-testid="aut-cancelar"
                  @acionar="cancelar(p)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.autorizacao,
.novo,
.resposta,
.acoes {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.cids {
  display: block;
}
.erro {
  color: var(--sgh-alerta);
}
</style>
