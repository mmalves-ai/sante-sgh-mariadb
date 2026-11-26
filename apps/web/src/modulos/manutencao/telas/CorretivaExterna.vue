<script setup lang="ts">
// Orçamento e conserto externo da OS (C2-089, 04-HOT L135), dentro do detalhe da OS: o orçamento do serviço (o novo
// substitui o pendente), a decisão do aprovador vigente da oficina dentro da alçada (nunca quem registrou; reprovação
// justificada), a saída do equipamento ao fornecedor com termo, nota e CFOP de remessa para conserto (a OS passa a
// aguardar o fornecedor) e o retorno (a OS volta ao atendimento; sem conserto, a observação é obrigatória). A tela
// confere na hora o que a regra do domínio confere; o servidor decide (alçada, segregação, situação).
import { JUSTIFICATIVA_MINIMA_ORCAMENTO } from '@sgh/dominio-manutencao';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarFornecedores } from '../api-manutencao.js';
import {
  decidirOrcamento,
  enviarRemessa,
  lerCorretivaExterna,
  registrarOrcamento,
  registrarRetorno,
  type CfopRemessa,
  type MotivoSemOrcamento,
  type OrcamentoDaOs,
  type RemessaDaOs,
  type ResultadoRetorno,
} from '../api-manutencao-corretiva.js';
import { comTodos, dataBr, instanteBr, reais, reaisDigitados } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ os: number; ligada: boolean }>();
const emit = defineEmits<{ gravado: [string] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const k = (c: string, p?: Record<string, unknown>) =>
  p ? t(`manutencao.corretiva.${c}`, p) : t(`manutencao.corretiva.${c}`);

const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'os', 'corretiva', props.os]),
  queryFn: () => lerCorretivaExterna(props.os),
});
const c = computed(() => consulta.data.value ?? null);
const fechada = computed(() => ['concluida', 'encerrada', 'cancelada'].includes(c.value?.situacaoOs ?? ''));
const pendente = computed<OrcamentoDaOs | null>(
  () => c.value?.orcamentos.find((x) => x.situacao === 'pendente') ?? null,
);
const aprovado = computed<OrcamentoDaOs | null>(
  () => c.value?.orcamentos.find((x) => x.situacao === 'aprovado') ?? null,
);
const remessaAberta = computed<RemessaDaOs | null>(
  () => c.value?.remessas.find((x) => x.situacao === 'enviado') ?? null,
);

// ── Fornecedor (busca no servidor) ─────────────────────────────────────────────────────────────────────────────────
const termoFornecedor = ref('');
const buscado = ref<string | null>(null);
const fornecedores = useQuery({
  queryKey: computed(() => ['manutencao', 'fornecedores', buscado.value]),
  queryFn: () => buscarFornecedores(buscado.value ?? ''),
  enabled: computed(() => buscado.value !== null),
});
const opcoesFornecedor = computed(() => {
  const lista = (fornecedores.data.value ?? []).map((f) => ({
    valor: f.codigo as number | null,
    rotulo: `${f.nome} (${f.codigo})`,
  }));
  const a = aprovado.value;
  if (a?.fornecedor && !lista.some((o) => o.valor === a.fornecedor))
    lista.unshift({ valor: a.fornecedor, rotulo: a.fornecedorNome ?? String(a.fornecedor) });
  return comTodos(t('manutencao.nenhumSelecionado'), lista);
});

// ── Formulários ────────────────────────────────────────────────────────────────────────────────────────────────────
type Acao = 'orcamento' | 'remessa';
const acao = ref<Acao | null>(null);
const fornecedor = ref<number | null>(null);
const descricao = ref('');
const valor = ref('');
const prazo = ref('');
const validade = ref<string | null>(null);
const termo = ref('');
const nota = ref('');
const cfop = ref<CfopRemessa | null>(null);
const previsao = ref<string | null>(null);
const motivoSem = ref<MotivoSemOrcamento | null>(null);
const justificativaSem = ref('');
const justificativa = ref('');
const resultado = ref<ResultadoRetorno>('consertado');
const observacao = ref('');
const notaRetorno = ref('');
const problemas = ref<string[]>([]);
const erro = ref<unknown>(null);
const gravando = ref(false);

const opcoesCfop = computed(() => [
  { valor: null as CfopRemessa | null, rotulo: k('cfops.nenhum') },
  { valor: '5915' as CfopRemessa | null, rotulo: k('cfops.5915') },
  { valor: '6915' as CfopRemessa | null, rotulo: k('cfops.6915') },
]);
const opcoesMotivoSem = computed(() =>
  (['garantia', 'contrato', 'comodato'] as const).map((m) => ({
    valor: m as MotivoSemOrcamento | null,
    rotulo: k(`motivosSemOrcamento.${m}`),
  })),
);
const opcoesResultado = computed(() =>
  (['consertado', 'sem_conserto'] as const).map((r) => ({ valor: r, rotulo: k(`resultados.${r}`) })),
);

function abrir(a: Acao) {
  acao.value = a;
  problemas.value = [];
  erro.value = null;
  fornecedor.value = a === 'remessa' ? (aprovado.value?.fornecedor ?? null) : null;
  motivoSem.value = null;
  justificativaSem.value = '';
}

async function gravar(fn: () => Promise<{ mensagem: string }>) {
  if (problemas.value.length > 0) return;
  erro.value = null;
  gravando.value = true;
  try {
    const r = await fn();
    acao.value = null;
    justificativa.value = '';
    observacao.value = '';
    await cliente.invalidateQueries({ queryKey: ['manutencao'] });
    emit('gravado', r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

function gravarOrcamento() {
  const x = c.value;
  if (!x) return;
  const v = reaisDigitados(valor.value);
  const p = prazo.value.trim() ? Number(prazo.value.trim()) : null;
  problemas.value = [
    ...(!descricao.value.trim() ? [t('manutencao.recusas.corretiva.descricao-obrigatoria')] : []),
    ...(v === null || v <= 0 ? [k('valorInvalido')] : []),
    ...(p !== null && !(Number.isInteger(p) && p > 0) ? [k('prazoInvalido')] : []),
  ];
  void gravar(() =>
    registrarOrcamento(props.os, {
      versaoOs: x.versaoOs,
      fornecedor: fornecedor.value,
      descricao: descricao.value.trim(),
      valor: v ?? 0,
      prazoDias: p,
      validade: validade.value,
    }),
  );
}

function decidir(o: OrcamentoDaOs, decisao: 'aprovado' | 'reprovado') {
  const j = justificativa.value.trim();
  problemas.value =
    decisao === 'reprovado' && j.length < JUSTIFICATIVA_MINIMA_ORCAMENTO
      ? [t('manutencao.recusas.corretiva.justificativa-curta')]
      : [];
  void gravar(() => decidirOrcamento(o.id, { versao: o.versao, decisao, justificativa: j || null }));
}

function gravarRemessa() {
  const x = c.value;
  if (!x) return;
  problemas.value = [
    ...(fornecedor.value === null ? [k('fornecedorObrigatorio')] : []),
    ...(!termo.value.trim() ? [t('manutencao.recusas.corretiva.termo-obrigatorio')] : []),
    ...(previsao.value && previsao.value < new Date().toISOString().slice(0, 10)
      ? [t('manutencao.recusas.corretiva.previsao-invertida')]
      : []),
    // Sem orçamento aprovado, só a saída sem custo, com motivo e justificativa (a mesma regra do domínio).
    ...(!aprovado.value && motivoSem.value === null ? [t('manutencao.recusas.corretiva.sem-orcamento')] : []),
    ...(!aprovado.value && motivoSem.value !== null && justificativaSem.value.trim().length < 10
      ? [t('manutencao.recusas.corretiva.justificativa-sem-orcamento')]
      : []),
  ];
  const sem =
    !aprovado.value && motivoSem.value !== null
      ? { motivo: motivoSem.value, justificativa: justificativaSem.value.trim() }
      : null;
  void gravar(() =>
    enviarRemessa(props.os, {
      versaoOs: x.versaoOs,
      fornecedor: fornecedor.value ?? 0,
      termo: termo.value.trim(),
      notaFiscal: nota.value.trim() || null,
      cfop: cfop.value,
      previsaoRetorno: previsao.value,
      semOrcamento: sem,
    }),
  );
}

function gravarRetorno(r: RemessaDaOs) {
  const obs = observacao.value.trim();
  problemas.value =
    resultado.value === 'sem_conserto' && obs.length < JUSTIFICATIVA_MINIMA_ORCAMENTO
      ? [t('manutencao.recusas.corretiva.justificativa-curta')]
      : [];
  void gravar(() =>
    registrarRetorno(r.id, {
      versao: r.versao,
      retornadoEm: null,
      notaFiscal: notaRetorno.value.trim() || null,
      resultado: resultado.value,
      observacao: obs || null,
    }),
  );
}
</script>

<template>
  <section class="bloco" aria-labelledby="os-corretiva-titulo" data-testid="os-corretiva">
    <h3 id="os-corretiva-titulo">{{ k('titulo') }}</h3>
    <ErroManutencao v-if="consulta.error.value" :erro="consulta.error.value" grupo="corretiva" />
    <template v-else-if="c">
      <p class="secundario">{{ c.oficinaNome ? k('oficina', { nome: c.oficinaNome }) : k('semOficina') }}</p>

      <h4>{{ k('orcamentos') }}</h4>
      <p v-if="c.orcamentos.length === 0" class="secundario">{{ k('nenhumOrcamento') }}</p>
      <ul v-else class="historico" data-testid="os-corretiva-orcamentos">
        <li v-for="o in c.orcamentos" :key="o.id" :data-testid="`os-orcamento-${o.situacao}`">
          <strong>{{ reais(o.valor) }}</strong> - {{ o.descricao }}
          <template v-if="o.fornecedorNome"> ({{ o.fornecedorNome }})</template>
          · {{ k(`situacoesOrcamento.${o.situacao}`) }}
          <span class="secundario">
            · {{ k('registradoPor', { nome: o.registradoPorNome, em: instanteBr(o.registradoEm) }) }}
            <template v-if="o.validade"> · {{ k('campos.validade') }}: {{ dataBr(o.validade) }}</template>
            <template v-if="o.decididoPorNome">
              · {{ k('decididoPor', { nome: o.decididoPorNome, em: instanteBr(o.decididoEm) }) }}</template
            >
            <template v-if="o.justificativa"> · {{ o.justificativa }}</template>
          </span>
        </li>
      </ul>
      <div v-if="pendente && !fechada" class="campos" data-testid="os-corretiva-decisao">
        <SanteCampoTexto
          v-model="justificativa"
          class="largo"
          :rotulo="k('campos.justificativa')"
          :max-bytes="1000"
          data-testid="os-orcamento-justificativa"
        />
        <p class="secundario">{{ k('campos.justificativaAjuda') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="k('acoes.aprovar')"
            :desabilitado="gravando || !ligada"
            data-testid="os-orcamento-aprovar"
            @acionar="decidir(pendente, 'aprovado')"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="k('acoes.reprovar')"
            :desabilitado="gravando || !ligada"
            data-testid="os-orcamento-reprovar"
            @acionar="decidir(pendente, 'reprovado')"
          />
        </div>
      </div>

      <h4>{{ k('remessas') }}</h4>
      <p v-if="c.remessas.length === 0" class="secundario">{{ k('nenhumaRemessa') }}</p>
      <ul v-else class="historico" data-testid="os-corretiva-remessas">
        <li v-for="r in c.remessas" :key="r.id" :data-testid="`os-remessa-${r.situacao}`">
          {{ r.fornecedorNome }} · {{ instanteBr(r.enviadoEm) }} · {{ k(`situacoesRemessa.${r.situacao}`) }}
          <template v-if="r.cfop"> · {{ k('cfopDe', { cfop: r.cfop }) }}</template>
          <template v-if="r.motivoSemOrcamento">
            ·
            {{ k('semOrcamentoDe', { motivo: k(`motivosSemOrcamento.${r.motivoSemOrcamento}`) }) }}</template
          >
          <template v-if="r.notaFiscalRemessa">
            · {{ k('campos.notaFiscal') }} {{ r.notaFiscalRemessa }}</template
          >
          <template v-if="r.previsaoRetorno">
            · {{ k('campos.previsao') }}: {{ dataBr(r.previsaoRetorno) }}</template
          >
          <strong v-if="r.atrasada" class="vencido"> · {{ k('atrasada') }}</strong>
          <template v-if="r.resultado">
            · {{ k(`resultados.${r.resultado}`) }} {{ instanteBr(r.retornadoEm) }}</template
          >
          <span class="secundario"> · {{ r.termoSaida }}</span>
        </li>
      </ul>
      <form
        v-if="remessaAberta"
        class="campos"
        data-testid="os-corretiva-retorno"
        @submit.prevent="gravarRetorno(remessaAberta)"
      >
        <SanteSelecao
          v-model="resultado"
          :rotulo="k('campos.resultado')"
          :opcoes="opcoesResultado"
          data-testid="os-retorno-resultado"
        />
        <SanteCampoTexto
          v-model="notaRetorno"
          :rotulo="k('campos.notaFiscal')"
          :max-bytes="20"
          data-testid="os-retorno-nota"
        />
        <SanteCampoTexto
          v-model="observacao"
          class="largo"
          :rotulo="k('campos.observacao')"
          :max-bytes="1000"
          data-testid="os-retorno-observacao"
        />
        <p class="secundario">{{ k('campos.observacaoAjuda') }}</p>
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="k('acoes.retorno')"
            :desabilitado="gravando || !ligada"
            data-testid="os-retorno-gravar"
          />
        </div>
      </form>

      <div v-if="!fechada && !remessaAberta && acao === null" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="k('acoes.orcamento')"
          :desabilitado="!ligada"
          data-testid="os-corretiva-novo-orcamento"
          @acionar="abrir('orcamento')"
        />
        <SanteBotao
          v-if="c.equipamento !== null && !pendente"
          variante="secundario"
          :rotulo="k('acoes.remessa')"
          :desabilitado="!ligada"
          data-testid="os-corretiva-nova-remessa"
          @acionar="abrir('remessa')"
        />
      </div>

      <!-- novalidate: o obrigatório fica no rótulo e no aria-required; a conferência é a da regra do domínio (a
           saída sem custo, a justificativa), mostrada em os-corretiva-problemas, e não o balão do navegador. -->
      <form
        v-if="acao"
        class="bloco"
        novalidate
        :data-testid="`os-corretiva-form-${acao}`"
        @submit.prevent="acao === 'orcamento' ? gravarOrcamento() : gravarRemessa()"
      >
        <h4>{{ k(`acoes.${acao}`) }}</h4>
        <div class="campos">
          <SanteCampoTexto
            v-model="termoFornecedor"
            :rotulo="k('campos.buscarFornecedor')"
            :max-bytes="80"
            data-testid="os-corretiva-termo-fornecedor"
            @keydown.enter.prevent="buscado = termoFornecedor.trim()"
          />
          <SanteBotao
            variante="texto"
            :rotulo="k('campos.buscarFornecedor')"
            data-testid="os-corretiva-buscar-fornecedor"
            @acionar="buscado = termoFornecedor.trim()"
          />
          <SanteSelecao
            v-model="fornecedor"
            :rotulo="k('campos.fornecedor')"
            :opcoes="opcoesFornecedor"
            data-testid="os-corretiva-fornecedor"
          />
        </div>
        <template v-if="acao === 'orcamento'">
          <SanteCampoTexto
            v-model="descricao"
            multilinha
            obrigatorio
            :rotulo="k('campos.descricao')"
            :max-bytes="1000"
            data-testid="os-orcamento-descricao"
          />
          <div class="campos">
            <SanteCampoTexto
              v-model="valor"
              obrigatorio
              :rotulo="k('campos.valor')"
              :max-bytes="16"
              data-testid="os-orcamento-valor"
            />
            <SanteCampoTexto
              v-model="prazo"
              :rotulo="k('campos.prazoDias')"
              :max-bytes="4"
              data-testid="os-orcamento-prazo"
            />
            <SanteData
              v-model="validade"
              editavel
              :rotulo="k('campos.validade')"
              data-testid="os-orcamento-validade"
            />
          </div>
        </template>
        <template v-else>
          <SanteCampoTexto
            v-model="termo"
            multilinha
            obrigatorio
            :rotulo="k('campos.termo')"
            :max-bytes="1000"
            data-testid="os-remessa-termo"
          />
          <p class="secundario">{{ k('campos.termoAjuda') }}</p>
          <template v-if="!aprovado">
            <p class="secundario" data-testid="os-remessa-sem-orcamento-ajuda">
              {{ k('campos.semOrcamentoAjuda') }}
            </p>
            <div class="campos">
              <SanteSelecao
                v-model="motivoSem"
                obrigatorio
                :rotulo="k('campos.motivoSemOrcamento')"
                :opcoes="opcoesMotivoSem"
                data-testid="os-remessa-motivo-sem-orcamento"
              />
              <SanteCampoTexto
                v-model="justificativaSem"
                multilinha
                obrigatorio
                :rotulo="k('campos.justificativaSemOrcamento')"
                :max-bytes="500"
                data-testid="os-remessa-justificativa-sem-orcamento"
              />
            </div>
          </template>
          <div class="campos">
            <SanteCampoTexto
              v-model="nota"
              :rotulo="k('campos.notaFiscal')"
              :max-bytes="20"
              data-testid="os-remessa-nota"
            />
            <SanteSelecao
              v-model="cfop"
              :rotulo="k('campos.cfop')"
              :opcoes="opcoesCfop"
              data-testid="os-remessa-cfop"
            />
            <SanteData
              v-model="previsao"
              editavel
              :rotulo="k('campos.previsao')"
              data-testid="os-remessa-previsao"
            />
          </div>
        </template>
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="k('gravar')"
            :desabilitado="gravando || !ligada"
            data-testid="os-corretiva-gravar"
          />
          <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="acao = null" />
        </div>
      </form>

      <ul v-if="problemas.length > 0" class="vencido" role="alert" data-testid="os-corretiva-problemas">
        <li v-for="x in problemas" :key="x">{{ x }}</li>
      </ul>
      <ErroManutencao v-if="erro" :erro="erro" grupo="corretiva" />
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
