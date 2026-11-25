<script setup lang="ts">
// Seguro dos bens (F8, 07-FIN linha 149; item `Controladoria > Patrimônio > Seguro dos bens`; `patrimonio.bem.ler`):
// apólices com a vigência vista (vigente, a vencer, vencida), o prêmio e o total segurado; no detalhe, os bens cobertos
// com o valor contábil ao lado e o selo de subseguro (segurado abaixo de 80% do contábil: a indenização sofre rateio).
// Incluir, segurar, retirar e cancelar pedem `patrimonio.bem.cadastrar`; o servidor confere tudo de novo. Nada se
// apaga: o bem retirado e a apólice cancelada ficam no histórico.
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { usarSessao } from '../../casca/sessao/sessao.js';
import {
  type ApoliceLida,
  type BemSeguradoLido,
  cancelarApolice,
  incluirApolice,
  lerApoioComplementos,
  lerApolice,
  lerApolices,
  retirarBemSegurado,
  segurarBem,
  TIPOS_SEGURO,
} from './api-complementos.js';
import BuscaBem from './BuscaBem.vue';
import { centavosOuZero, dataBr, hojeLocal, reais } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const hoje = computed(() => props.hoje ?? hojeLocal());
const K = 'patrimonio.complementos.seguros';
const podeGravar = computed(() => permissoes.value.has('patrimonio.bem.cadastrar'));

const apoio = useQuery({
  queryKey: ['patrimonio', 'complementos', 'apoio'],
  queryFn: lerApoioComplementos,
  retry: false,
});
const apolices = useQuery({ queryKey: ['patrimonio', 'apolices'], queryFn: lerApolices, retry: false });
const aberta = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['patrimonio', 'apolice', aberta.value]),
  queryFn: () => lerApolice(aberta.value!),
  enabled: computed(() => aberta.value !== null),
  retry: false,
});
const apolice = computed(() => (aberta.value === null ? null : (detalhe.data.value ?? null)));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
type Painel = 'nova' | 'segurar' | 'cancelar' | null;
const painel = ref<Painel>(null);

function abrirPainel(p: Painel) {
  painel.value = p;
  mensagem.value = null;
  erro.value = null;
}
async function executar(acao: () => Promise<string>) {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await acao();
    painel.value = null;
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'apolices'] });
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'apolice'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const textoOuNulo = (s: string) => (s.trim() === '' ? null : s.trim());

// ── Incluir apólice ──
const novaVazia = () => ({
  numero: '',
  tipo: 'patrimonial',
  seguradora: '',
  corretorNome: '',
  corretorTelefone: '',
  corretorEmail: '',
  cobertura: '',
  inicio: hoje.value,
  fim: '',
  premio: '',
  franquia: '',
  anterior: '',
});
const n = ref(novaVazia());
const opcoesTipo = TIPOS_SEGURO.map((x) => ({ valor: x, rotulo: t(`${K}.tipos.${x}`) }));
const opcoesSeguradora = computed(() => [
  { valor: '', rotulo: '—' },
  ...(apoio.data.value?.seguradoras ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);
const opcoesAnterior = computed(() => [
  { valor: '', rotulo: t('patrimonio.complementos.nenhumaOpcao') },
  ...(apolices.data.value ?? [])
    .filter((a) => a.situacaoVista !== 'cancelada' && a.situacaoVista !== 'renovada')
    .map((a) => ({ valor: String(a.id), rotulo: `${a.numero} — ${a.seguradora.nome}` })),
]);
/** Ao renovar, a nova apólice herda tipo, seguradora e corretor da anterior (menos digitação). */
function aoEscolherAnterior(v: string) {
  n.value.anterior = v;
  const a = (apolices.data.value ?? []).find((x) => String(x.id) === v);
  if (!a) return;
  n.value = {
    ...n.value,
    tipo: a.tipo,
    seguradora: String(a.seguradora.id),
    corretorNome: a.corretorNome ?? '',
    corretorTelefone: a.corretorTelefone ?? '',
    corretorEmail: a.corretorEmail ?? '',
    cobertura: a.cobertura ?? '',
  };
}
const problemasNova = computed(() => {
  const p: string[] = [];
  const x = n.value;
  if (x.numero.trim() === '') p.push('numero');
  if (x.seguradora === '') p.push('seguradora');
  if (x.inicio === '') p.push('inicio');
  if (x.fim === '' || x.fim <= x.inicio) p.push('fim');
  const pr = centavosOuZero(x.premio);
  if (x.premio.trim() === '' || pr === null) p.push('premio');
  if (x.franquia.trim() !== '' && centavosOuZero(x.franquia) === null) p.push('franquia');
  return p;
});
function gravarNova() {
  if (problemasNova.value.length > 0) return;
  const x = n.value;
  void executar(async () => {
    const r = await incluirApolice({
      numero: x.numero.trim(),
      tipo: x.tipo,
      seguradora: Number(x.seguradora),
      corretorNome: textoOuNulo(x.corretorNome),
      corretorTelefone: textoOuNulo(x.corretorTelefone),
      corretorEmail: textoOuNulo(x.corretorEmail),
      cobertura: textoOuNulo(x.cobertura),
      inicio: x.inicio,
      fim: x.fim,
      premioCent: centavosOuZero(x.premio) ?? 0,
      franquiaCent: x.franquia.trim() === '' ? null : centavosOuZero(x.franquia),
      titulo: null,
      anterior: x.anterior === '' ? null : Number(x.anterior),
    });
    n.value = novaVazia();
    aberta.value = r.id;
    return t(`${K}.incluida`);
  });
}

// ── Segurar bem ──
const sVazio = () => ({ bem: null as number | null, valor: '', inicio: hoje.value });
const s = ref(sVazio());
const problemasSegurar = computed(() => {
  const p: string[] = [];
  if (s.value.bem === null) p.push('bem');
  const v = centavosOuZero(s.value.valor);
  if (s.value.valor.trim() === '' || v === null || v <= 0) p.push('valor');
  if (s.value.inicio === '') p.push('data');
  return p;
});
function gravarSegurar(a: ApoliceLida) {
  if (problemasSegurar.value.length > 0) return;
  void executar(async () => {
    await segurarBem(a.id, {
      versao: a.versao,
      bem: s.value.bem!,
      valorSeguradoCent: centavosOuZero(s.value.valor) ?? 0,
      inicio: s.value.inicio,
    });
    s.value = sVazio();
    return t(`${K}.segurado`);
  });
}

// ── Retirar bem / cancelar apólice ──
const retirando = ref<BemSeguradoLido | null>(null);
const retirada = ref({ data: '', motivo: '' });
const retiradaPronta = computed(() => retirada.value.data !== '' && retirada.value.motivo.trim().length >= 5);
function abrirRetirada(b: BemSeguradoLido) {
  retirando.value = b;
  retirada.value = { data: hoje.value, motivo: '' };
  mensagem.value = null;
  erro.value = null;
}
function gravarRetirada() {
  const b = retirando.value;
  if (!b || !retiradaPronta.value) return;
  void executar(async () => {
    await retirarBemSegurado(b.id, { data: retirada.value.data, motivo: retirada.value.motivo.trim() });
    retirando.value = null;
    return t(`${K}.retirado`);
  });
}
const motivo = ref('');
function gravarCancelamento(a: ApoliceLida) {
  if (motivo.value.trim().length < 5) return;
  void executar(async () => {
    await cancelarApolice(a.id, { versao: a.versao, motivo: motivo.value.trim() });
    motivo.value = '';
    return t(`${K}.cancelada`);
  });
}
const periodo = (a: ApoliceLida) => `${dataBr(a.inicio)} – ${dataBr(a.fim)}`;
const ativaParaGravar = (a: ApoliceLida) => a.situacaoVista !== 'cancelada' && a.situacaoVista !== 'renovada';
</script>

<template>
  <section class="tela-patrimonio" aria-labelledby="seguros-titulo" data-testid="tela-seguros">
    <h1 id="seguros-titulo">{{ t(`${K}.titulo`) }}</h1>
    <p>{{ t(`${K}.descricao`) }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-if="!podeGravar" class="secundario">{{ t('patrimonio.complementos.semPermissao') }}</p>
    <p v-if="mensagem" role="status" class="ok" data-testid="seguros-mensagem">{{ mensagem }}</p>
    <ErroPatrimonio v-if="erro" :erro="erro" escopo="complementos" />

    <div v-if="podeGravar && painel !== 'nova'" class="acoes">
      <SanteBotao :rotulo="t(`${K}.nova`)" data-testid="seguros-nova" @acionar="abrirPainel('nova')" />
    </div>

    <form v-if="painel === 'nova'" class="bloco" data-testid="seguros-form" @submit.prevent="gravarNova">
      <h2>{{ t(`${K}.nova`) }}</h2>
      <div class="campos">
        <SanteSelecao
          :model-value="n.anterior"
          :rotulo="t(`${K}.anterior`)"
          :opcoes="opcoesAnterior"
          busca
          data-testid="seguros-anterior"
          @update:model-value="aoEscolherAnterior"
        />
        <SanteCampoTexto
          v-model="n.numero"
          :rotulo="t(`${K}.numero`)"
          :max-bytes="40"
          obrigatorio
          data-testid="seguros-numero"
        />
        <SanteSelecao
          v-model="n.tipo"
          :rotulo="t(`${K}.tipo`)"
          :opcoes="opcoesTipo"
          data-testid="seguros-tipo"
        />
        <SanteSelecao
          v-model="n.seguradora"
          :rotulo="t(`${K}.seguradora`)"
          :opcoes="opcoesSeguradora"
          obrigatorio
          busca
          data-testid="seguros-seguradora"
        />
        <SanteData v-model="n.inicio" :rotulo="t(`${K}.inicio`)" editavel data-testid="seguros-inicio" />
        <SanteData v-model="n.fim" :rotulo="t(`${K}.fim`)" editavel data-testid="seguros-fim" />
        <SanteCampoTexto
          v-model="n.premio"
          :rotulo="t(`${K}.premio`)"
          :max-bytes="20"
          obrigatorio
          data-testid="seguros-premio"
        />
        <SanteCampoTexto
          v-model="n.franquia"
          :rotulo="t(`${K}.franquia`)"
          :max-bytes="20"
          data-testid="seguros-franquia"
        />
        <SanteCampoTexto
          v-model="n.corretorNome"
          :rotulo="t(`${K}.corretorNome`)"
          :max-bytes="120"
          data-testid="seguros-corretor"
        />
        <SanteCampoTexto
          v-model="n.corretorTelefone"
          :rotulo="t(`${K}.corretorTelefone`)"
          :max-bytes="20"
          data-testid="seguros-corretor-telefone"
        />
        <SanteCampoTexto
          v-model="n.corretorEmail"
          :rotulo="t(`${K}.corretorEmail`)"
          :max-bytes="120"
          data-testid="seguros-corretor-email"
        />
        <SanteCampoTexto
          v-model="n.cobertura"
          :rotulo="t(`${K}.cobertura`)"
          :max-bytes="1000"
          multilinha
          data-testid="seguros-cobertura"
        />
      </div>
      <ul v-if="problemasNova.length > 0" class="secundario" data-testid="seguros-problemas">
        <li v-for="p in problemasNova" :key="p">{{ t(`${K}.problemas.${p}`) }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('patrimonio.gravar')"
          :desabilitado="ocupado || problemasNova.length > 0"
          data-testid="seguros-gravar"
        />
      </div>
    </form>

    <MensagemErro v-if="apolices.isError.value" :erro="apolices.error.value" />
    <p v-else-if="!apolices.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
    <p v-else-if="apolices.data.value.length === 0" data-testid="seguros-nenhuma">{{ t(`${K}.nenhuma`) }}</p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-apolices">
        <thead>
          <tr>
            <th scope="col">{{ t(`${K}.numero`) }}</th>
            <th scope="col">{{ t(`${K}.seguradora`) }}</th>
            <th scope="col">{{ t(`${K}.tipo`) }}</th>
            <th scope="col">{{ t(`${K}.vigencia`) }}</th>
            <th scope="col">{{ t(`${K}.premio`) }}</th>
            <th scope="col">{{ t(`${K}.total`) }}</th>
            <th scope="col">{{ t(`${K}.bens`) }}</th>
            <th scope="col"><span class="secundario">—</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in apolices.data.value" :key="a.id" :data-testid="`apolice-${a.id}`">
            <td>{{ a.numero }}</td>
            <td>{{ a.seguradora.nome }}</td>
            <td>{{ t(`${K}.tipos.${a.tipo}`) }}</td>
            <td>
              {{ periodo(a) }}
              <br />
              <strong :data-testid="`apolice-situacao-${a.id}`">{{
                t(`${K}.situacoes.${a.situacaoVista}`)
              }}</strong>
            </td>
            <td>{{ reais(a.premioCent) }}</td>
            <td>{{ reais(a.totalSeguradoCent) }}</td>
            <td>{{ a.bensCobertos }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t(`${K}.abrir`)"
                :data-testid="`apolice-abrir-${a.id}`"
                @acionar="
                  aberta = a.id;
                  painel = null;
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="apolice" class="bloco" aria-labelledby="apolice-detalhe" data-testid="apolice-detalhe">
      <h2 id="apolice-detalhe">{{ apolice.numero }} — {{ apolice.seguradora.nome }}</h2>
      <dl class="dados">
        <dt>{{ t(`${K}.vigencia`) }}</dt>
        <dd>
          {{ `${periodo(apolice)} · ${t(`${K}.situacoes.${apolice.situacaoVista}`)}` }}
        </dd>
        <dt>{{ t(`${K}.franquia`) }}</dt>
        <dd>{{ apolice.franquiaCent === null ? '—' : reais(apolice.franquiaCent) }}</dd>
        <dt>{{ t(`${K}.corretorNome`) }}</dt>
        <dd>{{ apolice.corretorNome ?? '—' }}</dd>
        <dt>{{ t(`${K}.cobertura`) }}</dt>
        <dd>{{ apolice.cobertura ?? '—' }}</dd>
      </dl>

      <h3>{{ t(`${K}.bensCobertos`) }}</h3>
      <p v-if="(apolice.bens ?? []).length === 0" class="secundario">{{ t(`${K}.semBens`) }}</p>
      <ul v-else data-testid="apolice-bens">
        <li v-for="b in apolice.bens" :key="b.id" :data-testid="`segurado-${b.id}`">
          {{
            t(`${K}.linhaBem`, {
              plaqueta: b.plaqueta,
              descricao: b.descricao,
              segurado: reais(b.valorSeguradoCent),
              contabil: reais(b.valorContabilCent),
            })
          }}
          <strong v-if="b.cobertura.subseguro" class="marca" :data-testid="`segurado-subseguro-${b.id}`">
            {{ t(`${K}.subseguro`) }} ({{ b.cobertura.percentual }}%)
          </strong>
          <span v-if="!b.ativo && b.fim" class="secundario">
            · {{ t(`${K}.retiradoEm`, { data: dataBr(b.fim) }) }}
          </span>
          <SanteBotao
            v-if="b.ativo && podeGravar && retirando?.id !== b.id"
            variante="texto"
            :rotulo="t(`${K}.retirar`)"
            :data-testid="`segurado-retirar-${b.id}`"
            @acionar="abrirRetirada(b)"
          />
          <form
            v-if="retirando?.id === b.id"
            class="bloco"
            :aria-label="t(`${K}.retirar`)"
            data-testid="retirada-form"
            @submit.prevent="gravarRetirada"
          >
            <div class="campos">
              <SanteData
                v-model="retirada.data"
                :rotulo="t(`${K}.dataRetirada`)"
                editavel
                data-testid="retirada-data"
              />
              <SanteCampoTexto
                v-model="retirada.motivo"
                :rotulo="t(`${K}.motivo`)"
                :max-bytes="400"
                multilinha
                obrigatorio
                data-testid="retirada-motivo"
              />
            </div>
            <div class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('patrimonio.cancelar')"
                @acionar="retirando = null"
              />
              <SanteBotao
                tipo="submit"
                variante="destrutivo"
                :rotulo="t(`${K}.retirar`)"
                :desabilitado="ocupado || !retiradaPronta"
                data-testid="retirada-gravar"
              />
            </div>
          </form>
        </li>
      </ul>

      <div v-if="podeGravar && ativaParaGravar(apolice) && painel === null" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${K}.segurar`)"
          data-testid="apolice-segurar"
          @acionar="abrirPainel('segurar')"
        />
        <SanteBotao
          variante="destrutivo"
          :rotulo="t(`${K}.cancelar`)"
          data-testid="apolice-cancelar"
          @acionar="abrirPainel('cancelar')"
        />
      </div>

      <form
        v-if="painel === 'segurar'"
        class="bloco"
        data-testid="segurar-form"
        @submit.prevent="gravarSegurar(apolice)"
      >
        <h3>{{ t(`${K}.segurar`) }}</h3>
        <div class="campos">
          <BuscaBem
            v-model="s.bem"
            :rotulo-busca="t(`${K}.buscarBem`)"
            :rotulo="t(`${K}.bem`)"
            testid="segurar-bem"
          />
          <SanteCampoTexto
            v-model="s.valor"
            :rotulo="t(`${K}.valorSegurado`)"
            :max-bytes="20"
            obrigatorio
            data-testid="segurar-valor"
          />
          <SanteData v-model="s.inicio" :rotulo="t(`${K}.inicioBem`)" editavel data-testid="segurar-inicio" />
        </div>
        <ul v-if="problemasSegurar.length > 0" class="secundario" data-testid="segurar-problemas">
          <li v-for="p in problemasSegurar" :key="p">{{ t(`${K}.problemas.${p}`) }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('patrimonio.gravar')"
            :desabilitado="ocupado || problemasSegurar.length > 0"
            data-testid="segurar-gravar"
          />
        </div>
      </form>

      <form
        v-if="painel === 'cancelar'"
        class="bloco"
        data-testid="cancelar-apolice-form"
        @submit.prevent="gravarCancelamento(apolice)"
      >
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t(`${K}.motivo`)"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="cancelar-apolice-motivo"
        />
        <p v-if="motivo !== '' && motivo.trim().length < 5" class="secundario">
          {{ t(`${K}.problemas.motivo`) }}
        </p>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="painel = null" />
          <SanteBotao
            tipo="submit"
            variante="destrutivo"
            :rotulo="t(`${K}.cancelar`)"
            :desabilitado="ocupado || motivo.trim().length < 5"
            data-testid="cancelar-apolice-gravar"
          />
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
