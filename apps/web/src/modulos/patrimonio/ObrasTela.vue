<script setup lang="ts">
// Imobilizado em andamento (F8, 07-FIN linha 149; item `Controladoria > Patrimônio > Imobilizado em andamento`;
// `patrimonio.bem.ler`; CPC 27 / NBC TG 27): obras, reformas e montagens acumulam os custos apropriados por título a
// pagar ou nota de entrada e não depreciam até a ativação, que gera o bem pelo custo acumulado. O consumo do orçamento
// aparece na lista (atenção a partir de 90%, estouro acima de 100%). Gravar pede `patrimonio.bem.cadastrar`; o servidor
// confere tudo de novo. Nada se apaga: a obra cancelada fica na lista, com o motivo.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { usarSessao } from '../../casca/sessao/sessao.js';
import {
  abrirObra,
  apropriar,
  ativarObra,
  cancelarObra,
  lerApoioComplementos,
  lerObra,
  lerObras,
  type ObraLida,
  type SituacaoObra,
} from './api-complementos.js';
import { centavosOuZero, dataBr, hojeLocal, reais } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const hoje = computed(() => props.hoje ?? hojeLocal());
const K = 'patrimonio.complementos';
const podeGravar = computed(() => permissoes.value.has('patrimonio.bem.cadastrar'));

const apoio = useQuery({
  queryKey: ['patrimonio', 'complementos', 'apoio'],
  queryFn: lerApoioComplementos,
  retry: false,
});
const filtro = ref<SituacaoObra | ''>('em_andamento');
const opcoesFiltro = [
  { valor: '', rotulo: t(`${K}.obras.todas`) },
  ...(['em_andamento', 'ativado', 'cancelado'] as const).map((s) => ({
    valor: s,
    rotulo: t(`${K}.obras.situacoes.${s}`),
  })),
];
const obras = useQuery({
  queryKey: computed(() => ['patrimonio', 'obras', filtro.value]),
  queryFn: () => lerObras(filtro.value === '' ? null : filtro.value),
  retry: false,
});
const aberta = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['patrimonio', 'obra', aberta.value]),
  queryFn: () => lerObra(aberta.value!),
  enabled: computed(() => aberta.value !== null),
  retry: false,
});
const obra = computed(() => (aberta.value === null ? null : (detalhe.data.value ?? null)));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
type Painel = 'nova' | 'apropriar' | 'ativar' | 'cancelar' | null;
const painel = ref<Painel>(null);

function abrirPainel(p: Painel) {
  painel.value = p;
  mensagem.value = null;
  erro.value = null;
}
async function atualizar() {
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'obras'] });
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'obra'] });
}
async function executar(acao: () => Promise<string>) {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await acao();
    painel.value = null;
    await atualizar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const textoOuNulo = (s: string) => (s.trim() === '' ? null : s.trim());
const opcional = (s: string) => (s.trim() === '' ? 0 : centavosOuZero(s));

// ── Abrir obra ──
const novaVazia = () => ({
  descricao: '',
  grupo: '',
  conta: '',
  centro: '',
  inicio: hoje.value,
  prevista: '',
  orcado: '',
  observacao: '',
});
const n = ref(novaVazia());
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: '—' },
  ...(apoio.data.value?.grupos ?? []).map((g) => ({
    valor: String(g.id),
    rotulo: `${g.codigo} — ${g.descricao}`,
  })),
]);
const opcoesConta = computed(() => [
  { valor: '', rotulo: t(`${K}.nenhumaOpcao`) },
  ...(apoio.data.value?.contas ?? []).map((c) => ({
    valor: String(c.id),
    rotulo: `${c.codigo} — ${c.descricao}`,
  })),
]);
const opcoesCentro = computed(() => [
  { valor: '', rotulo: t(`${K}.nenhumaOpcao`) },
  ...(apoio.data.value?.centros ?? []).map((c) => ({
    valor: String(c.id),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
]);
const problemasNova = computed(() => {
  const p: string[] = [];
  const x = n.value;
  if (x.descricao.trim().length < 5) p.push('descricao');
  if (x.grupo === '') p.push('grupo');
  if (x.inicio === '' || x.inicio > hoje.value) p.push('inicio');
  if (x.prevista !== '' && x.prevista < x.inicio) p.push('prevista');
  if (opcional(x.orcado) === null) p.push('orcado');
  return p;
});
function gravarNova() {
  if (problemasNova.value.length > 0) return;
  const x = n.value;
  void executar(async () => {
    const r = await abrirObra({
      descricao: x.descricao.trim(),
      grupo: Number(x.grupo),
      conta: x.conta === '' ? null : Number(x.conta),
      centro: x.centro === '' ? null : Number(x.centro),
      dataInicio: x.inicio,
      dataPrevista: x.prevista || null,
      orcadoCent: x.orcado.trim() === '' ? null : centavosOuZero(x.orcado),
      observacao: textoOuNulo(x.observacao),
    });
    n.value = novaVazia();
    aberta.value = r.id;
    return t(`${K}.obras.aberta`, { numero: r.numero });
  });
}

// ── Apropriar ──
const apVazia = () => ({ data: hoje.value, origem: 'titulo', documento: '', descricao: '', valor: '' });
const ap = ref(apVazia());
const opcoesDocumento = [
  { valor: 'titulo', rotulo: t(`${K}.obras.tituloCampo`) },
  { valor: 'nota', rotulo: t(`${K}.obras.notaCampo`) },
];
const problemasAp = computed(() => {
  const p: string[] = [];
  const x = ap.value;
  if (x.data === '' || x.data > hoje.value) p.push('data');
  if (!/^\d{1,12}$/.test(x.documento.trim())) p.push('documento');
  const v = centavosOuZero(x.valor);
  if (x.valor.trim() === '' || v === null || v <= 0) p.push('valor');
  return p;
});
function gravarApropriacao(o: ObraLida) {
  if (problemasAp.value.length > 0) return;
  const x = ap.value;
  const doc = Number(x.documento.trim());
  void executar(async () => {
    await apropriar(o.id, {
      versao: o.versao,
      data: x.data,
      titulo: x.origem === 'titulo' ? doc : null,
      nota: x.origem === 'nota' ? doc : null,
      descricao: textoOuNulo(x.descricao),
      valorCent: centavosOuZero(x.valor) ?? 0,
    });
    ap.value = apVazia();
    return t(`${K}.obras.apropriado`);
  });
}

// ── Ativar ──
const atVazia = () => ({ data: hoje.value, vida: '', plaqueta: '', origem: '', centro: '', residual: '' });
const at = ref(atVazia());
function abrirAtivacao(o: ObraLida) {
  const g = apoio.data.value?.grupos.find((x) => x.id === o.grupo.id);
  at.value = {
    ...atVazia(),
    vida: g?.vidaUtilMeses ? String(g.vidaUtilMeses) : '',
    centro: o.centro ? String(o.centro) : '',
  };
  abrirPainel('ativar');
}
const opcoesOrigem = computed(() => [
  { valor: '', rotulo: '—' },
  ...(apoio.data.value?.origens ?? []).map((o) => ({ valor: String(o.id), rotulo: o.descricao })),
]);
const problemasAt = computed(() => {
  const p: string[] = [];
  const x = at.value;
  if (obra.value && obra.value.acumuladoCent <= 0) p.push('semCusto');
  if (x.data === '' || x.data > hoje.value) p.push('data');
  if (!/^\d{1,4}$/.test(x.vida.trim()) || Number(x.vida) < 1 || Number(x.vida) > 1200) p.push('vidaUtil');
  if (x.plaqueta.trim() === '') p.push('plaqueta');
  if (x.origem === '') p.push('origem');
  const r = opcional(x.residual);
  if (r === null || (obra.value && r > obra.value.acumuladoCent)) p.push('residual');
  return p;
});
function gravarAtivacao(o: ObraLida) {
  if (problemasAt.value.length > 0) return;
  const x = at.value;
  void executar(async () => {
    await ativarObra(o.id, {
      versao: o.versao,
      data: x.data,
      vidaUtilMeses: Number(x.vida),
      plaqueta: x.plaqueta.trim(),
      origem: Number(x.origem),
      centro: x.centro === '' ? null : Number(x.centro),
      residualCent: opcional(x.residual) ?? 0,
    });
    return t(`${K}.obras.ativada`, { plaqueta: x.plaqueta.trim() });
  });
}

// ── Cancelar ──
const motivo = ref('');
function gravarCancelamento(o: ObraLida) {
  if (motivo.value.trim().length < 5) return;
  void executar(async () => {
    await cancelarObra(o.id, { versao: o.versao, motivo: motivo.value.trim() });
    motivo.value = '';
    return t(`${K}.obras.cancelada`);
  });
}

function documentoDe(titulo: number | null, nota: number | null) {
  return titulo !== null ? t(`${K}.obras.tituloDoc`, { n: titulo }) : t(`${K}.obras.nota`, { n: nota ?? 0 });
}
</script>

<template>
  <section class="tela-patrimonio" aria-labelledby="obras-titulo" data-testid="tela-obras">
    <h1 id="obras-titulo">{{ t(`${K}.obras.titulo`) }}</h1>
    <p>{{ t(`${K}.obras.descricao`) }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-if="!podeGravar" class="secundario">{{ t(`${K}.semPermissao`) }}</p>
    <p v-if="mensagem" role="status" class="ok" data-testid="obras-mensagem">{{ mensagem }}</p>
    <ErroPatrimonio v-if="erro" :erro="erro" escopo="complementos" />

    <div class="campos">
      <SanteSelecao
        v-model="filtro"
        :rotulo="t(`${K}.obras.filtro`)"
        :opcoes="opcoesFiltro"
        data-testid="obras-filtro"
      />
    </div>
    <div v-if="podeGravar && painel !== 'nova'" class="acoes">
      <SanteBotao :rotulo="t(`${K}.obras.nova`)" data-testid="obras-nova" @acionar="abrirPainel('nova')" />
    </div>

    <form v-if="painel === 'nova'" class="bloco" data-testid="obras-form" @submit.prevent="gravarNova">
      <h2>{{ t(`${K}.obras.nova`) }}</h2>
      <div class="campos">
        <SanteCampoTexto
          v-model="n.descricao"
          :rotulo="t(`${K}.obras.descricaoCampo`)"
          :max-bytes="200"
          obrigatorio
          data-testid="obras-descricao"
        />
        <SanteSelecao
          v-model="n.grupo"
          :rotulo="t(`${K}.obras.grupo`)"
          :opcoes="opcoesGrupo"
          obrigatorio
          busca
          data-testid="obras-grupo"
        />
        <SanteSelecao
          v-model="n.conta"
          :rotulo="t(`${K}.obras.conta`)"
          :opcoes="opcoesConta"
          busca
          data-testid="obras-conta"
        />
        <SanteSelecao
          v-model="n.centro"
          :rotulo="t(`${K}.obras.centro`)"
          :opcoes="opcoesCentro"
          busca
          data-testid="obras-centro"
        />
        <SanteData
          v-model="n.inicio"
          :rotulo="t(`${K}.obras.inicio`)"
          editavel
          :maximo="hoje"
          data-testid="obras-inicio"
        />
        <SanteData
          v-model="n.prevista"
          :rotulo="t(`${K}.obras.prevista`)"
          editavel
          data-testid="obras-prevista"
        />
        <SanteCampoTexto
          v-model="n.orcado"
          :rotulo="t(`${K}.obras.orcado`)"
          :max-bytes="20"
          data-testid="obras-orcado"
        />
        <SanteCampoTexto
          v-model="n.observacao"
          :rotulo="t(`${K}.obras.observacao`)"
          :max-bytes="400"
          multilinha
          data-testid="obras-observacao"
        />
      </div>
      <ul v-if="problemasNova.length > 0" class="secundario" data-testid="obras-problemas">
        <li v-for="p in problemasNova" :key="p">{{ t(`${K}.obras.problemas.${p}`) }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('patrimonio.gravar')"
          :desabilitado="ocupado || problemasNova.length > 0"
          data-testid="obras-gravar"
        />
      </div>
    </form>

    <MensagemErro v-if="obras.isError.value" :erro="obras.error.value" />
    <p v-else-if="!obras.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
    <p v-else-if="obras.data.value.length === 0" data-testid="obras-nenhuma">{{ t(`${K}.obras.nenhuma`) }}</p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-obras">
        <thead>
          <tr>
            <th scope="col">{{ t(`${K}.obras.numero`) }}</th>
            <th scope="col">{{ t(`${K}.obras.descricaoCampo`) }}</th>
            <th scope="col">{{ t(`${K}.obras.inicio`) }}</th>
            <th scope="col">{{ t(`${K}.obras.acumulado`) }}</th>
            <th scope="col">{{ t(`${K}.obras.orcamento`) }}</th>
            <th scope="col">{{ t(`${K}.obras.filtro`) }}</th>
            <th scope="col"><span class="secundario">—</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in obras.data.value" :key="o.id" :data-testid="`obra-${o.id}`">
            <td>{{ o.numero }}</td>
            <td>{{ o.descricao }}</td>
            <td>{{ dataBr(o.dataInicio) }}</td>
            <td>{{ reais(o.acumuladoCent) }}</td>
            <td :data-testid="`obra-orcamento-${o.id}`">
              <template v-if="o.orcadoCent !== null">{{ reais(o.orcadoCent) }} · </template>
              <strong v-if="o.orcamento.estado === 'alerta' || o.orcamento.estado === 'estourado'">
                {{ t(`${K}.obras.estados.${o.orcamento.estado}`) }}
              </strong>
              <template v-else-if="o.orcamento.percentual !== null">
                {{ t(`${K}.obras.consumo`, { percentual: o.orcamento.percentual }) }}
              </template>
              <template v-else>{{ t(`${K}.obras.estados.${o.orcamento.estado}`) }}</template>
            </td>
            <td>
              {{ t(`${K}.obras.situacoes.${o.situacao}`) }}
              <template v-if="o.bem">
                · {{ t(`${K}.obras.bemGerado`, { plaqueta: o.bem.plaqueta }) }}</template
              >
            </td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t(`${K}.obras.abrir`)"
                :data-testid="`obra-abrir-${o.id}`"
                @acionar="
                  aberta = o.id;
                  painel = null;
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="obra" class="bloco" aria-labelledby="obra-detalhe" data-testid="obra-detalhe">
      <h2 id="obra-detalhe">{{ obra.numero }} — {{ obra.descricao }}</h2>
      <dl class="dados">
        <dt>{{ t(`${K}.obras.grupo`) }}</dt>
        <dd>{{ obra.grupo.codigo }} — {{ obra.grupo.descricao }}</dd>
        <dt>{{ t(`${K}.obras.acumulado`) }}</dt>
        <dd data-testid="obra-acumulado">{{ reais(obra.acumuladoCent) }}</dd>
        <dt>{{ t(`${K}.obras.prevista`) }}</dt>
        <dd>{{ obra.dataPrevista ? dataBr(obra.dataPrevista) : '—' }}</dd>
      </dl>
      <SanteAlerta
        v-if="obra.orcamento.estado === 'alerta' || obra.orcamento.estado === 'estourado'"
        :texto="t(`${K}.obras.estados.${obra.orcamento.estado}`)"
        :variante="obra.orcamento.estado === 'estourado' ? 'alerta' : 'aviso'"
        data-testid="obra-alerta-orcamento"
      />
      <h3>{{ t(`${K}.obras.apropriacoes`) }}</h3>
      <p v-if="(obra.apropriacoes ?? []).length === 0" class="secundario">
        {{ t(`${K}.obras.semApropriacao`) }}
      </p>
      <ul v-else data-testid="obra-apropriacoes">
        <li v-for="a in obra.apropriacoes" :key="a.id">
          {{
            t(`${K}.obras.apropriacaoLinha`, {
              data: dataBr(a.data),
              documento: documentoDe(a.titulo, a.nota),
              valor: reais(a.valorCent),
            })
          }}
          <span v-if="a.descricao" class="secundario"> · {{ a.descricao }}</span>
        </li>
      </ul>

      <div v-if="podeGravar && obra.situacao === 'em_andamento' && painel === null" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${K}.obras.apropriar`)"
          data-testid="obra-apropriar"
          @acionar="abrirPainel('apropriar')"
        />
        <SanteBotao
          :rotulo="t(`${K}.obras.ativar`)"
          data-testid="obra-ativar"
          @acionar="abrirAtivacao(obra)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${K}.obras.cancelar`)"
          data-testid="obra-cancelar"
          @acionar="abrirPainel('cancelar')"
        />
      </div>

      <form
        v-if="painel === 'apropriar'"
        class="bloco"
        data-testid="apropriacao-form"
        @submit.prevent="gravarApropriacao(obra)"
      >
        <h3>{{ t(`${K}.obras.apropriar`) }}</h3>
        <div class="campos">
          <SanteData
            v-model="ap.data"
            :rotulo="t(`${K}.obras.dataApropriacao`)"
            editavel
            :maximo="hoje"
            data-testid="apropriacao-data"
          />
          <SanteSelecao
            v-model="ap.origem"
            :rotulo="t(`${K}.obras.origemDocumento`)"
            :opcoes="opcoesDocumento"
            data-testid="apropriacao-origem"
          />
          <SanteCampoTexto
            v-model="ap.documento"
            :rotulo="ap.origem === 'titulo' ? t(`${K}.obras.tituloCampo`) : t(`${K}.obras.notaCampo`)"
            :max-bytes="12"
            obrigatorio
            data-testid="apropriacao-documento"
          />
          <SanteCampoTexto
            v-model="ap.descricao"
            :rotulo="t(`${K}.obras.descricaoApropriacao`)"
            :max-bytes="200"
            data-testid="apropriacao-descricao"
          />
          <SanteCampoTexto
            v-model="ap.valor"
            :rotulo="t(`${K}.obras.valor`)"
            :max-bytes="20"
            obrigatorio
            data-testid="apropriacao-valor"
          />
        </div>
        <ul v-if="problemasAp.length > 0" class="secundario" data-testid="apropriacao-problemas">
          <li v-for="p in problemasAp" :key="p">{{ t(`${K}.obras.problemas.${p}`) }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('patrimonio.gravar')"
            :desabilitado="ocupado || problemasAp.length > 0"
            data-testid="apropriacao-gravar"
          />
        </div>
      </form>

      <form
        v-if="painel === 'ativar'"
        class="bloco"
        data-testid="ativacao-form"
        @submit.prevent="gravarAtivacao(obra)"
      >
        <h3>{{ t(`${K}.obras.ativar`) }}</h3>
        <div class="campos">
          <SanteData
            v-model="at.data"
            :rotulo="t(`${K}.obras.dataAtivacao`)"
            editavel
            :maximo="hoje"
            data-testid="ativacao-data"
          />
          <SanteCampoTexto
            v-model="at.vida"
            :rotulo="t(`${K}.obras.vidaUtil`)"
            :max-bytes="4"
            obrigatorio
            data-testid="ativacao-vida"
          />
          <SanteCampoTexto
            v-model="at.plaqueta"
            :rotulo="t(`${K}.obras.plaqueta`)"
            :max-bytes="30"
            obrigatorio
            data-testid="ativacao-plaqueta"
          />
          <SanteSelecao
            v-model="at.origem"
            :rotulo="t(`${K}.obras.origem`)"
            :opcoes="opcoesOrigem"
            obrigatorio
            data-testid="ativacao-origem"
          />
          <SanteSelecao
            v-model="at.centro"
            :rotulo="t(`${K}.obras.centro`)"
            :opcoes="opcoesCentro"
            busca
            data-testid="ativacao-centro"
          />
          <SanteCampoTexto
            v-model="at.residual"
            :rotulo="t(`${K}.obras.residual`)"
            :max-bytes="20"
            data-testid="ativacao-residual"
          />
        </div>
        <ul v-if="problemasAt.length > 0" class="secundario" data-testid="ativacao-problemas">
          <li v-for="p in problemasAt" :key="p">{{ t(`${K}.obras.problemas.${p}`) }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
          <SanteBotao
            tipo="submit"
            :rotulo="t(`${K}.obras.ativar`)"
            :desabilitado="ocupado || problemasAt.length > 0"
            data-testid="ativacao-gravar"
          />
        </div>
      </form>

      <form v-if="painel === 'cancelar'" class="bloco" data-testid="cancelamento-form" @submit.prevent>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t(`${K}.obras.motivo`)"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="cancelamento-motivo"
        />
        <p v-if="motivo !== '' && motivo.trim().length < 5" class="secundario">
          {{ t(`${K}.obras.problemas.motivo`) }}
        </p>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
          <SanteBotao
            variante="destrutivo"
            :rotulo="t(`${K}.obras.cancelar`)"
            :confirmacao="t(`${K}.obras.perguntaCancelar`)"
            :desabilitado="ocupado || motivo.trim().length < 5"
            data-testid="cancelamento-gravar"
            @acionar="gravarCancelamento(obra)"
          />
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
