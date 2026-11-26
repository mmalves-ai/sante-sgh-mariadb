<script setup lang="ts">
// O que falta para operar (C2-025, 01-ADM L98): `/administracao/implantacao`. Sem implantação aberta, o diagnóstico
// do hospital pelo checklist padrão (contagem atual de cada cadastro mínimo) e o formulário para abrir a implantação.
// Aberta, o resumo por módulo com o percentual, a lista do que falta na ordem de fazer (crítico, atrasado, prazo), a
// edição em linha de prazo, responsável e dispensa com motivo (a regra do domínio confere na hora), a recontagem dos
// cadastros, a fase e a virada prevista, e as metas com a medição. O checklist padrão é editável pela plataforma.
// Nenhuma trava: o sistema mostra o que falta, a virada é decisão do hospital (ADR 0002).
import {
  conferirDatasImplantacao,
  conferirMeta,
  conferirMudancaItem,
  minimoEfetivo,
  SITUACOES_ITEM_PRONTIDAO,
  TIPOS_VERIFICACAO,
} from '@sgh/dominio-config/implantacao';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirImplantacao,
  alterarImplantacao,
  alterarItemImplantacao,
  FASES_IMPLANTACAO,
  incluirMetaImplantacao,
  INDICADORES_META,
  type ItemImplantacaoTela,
  lerModeloImplantacao,
  lerPainelImplantacao,
  medirMetaImplantacao,
  type MetaImplantacaoTela,
  recontarImplantacao,
  salvarItemModelo,
} from '../api-kit-implantacao.js';

const { t } = useI18n();
const k = (c: string, p?: Record<string, unknown>) => t(`config.kitImplantacao.${c}`, p ?? {});
const cliente = useQueryClient();
const erro = ref('');
const aviso = ref('');

const painel = useQuery({ queryKey: ['implantacao', 'kit'], queryFn: lerPainelImplantacao });
const modelo = useQuery({ queryKey: ['implantacao', 'kit', 'modelo'], queryFn: lerModeloImplantacao });
const aberta = computed(() => painel.data.value?.implantacao ?? null);

async function tentar(fn: () => Promise<unknown>, depois?: (r: unknown) => void): Promise<void> {
  erro.value = '';
  aviso.value = '';
  try {
    const r = await fn();
    aviso.value = k('feito');
    depois?.(r);
    await cliente.invalidateQueries({ queryKey: ['implantacao', 'kit'] });
  } catch (e) {
    erro.value = (e as Error).message;
  }
}
const ouNull = (s: string) => (s.trim() ? s.trim() : null);

// Abrir a implantação: datas conferidas na hora pela regra do domínio.
const nova = reactive({
  nome: '',
  inicio: '',
  fim: '',
  virada: '',
  responsavel: '',
  email: '',
  observacao: '',
});
const problemasAbrir = computed(() => [
  ...(nova.nome.trim().length < 3 ? [k('nome')] : []),
  ...conferirDatasImplantacao({
    dataInicioPrevista: nova.inicio || null,
    dataFimPrevista: nova.fim || null,
    dataViradaPrevista: nova.virada || null,
  }).map((p) => p.mensagem),
]);
const abrir = () =>
  tentar(() =>
    abrirImplantacao({
      nome: nova.nome.trim(),
      dataInicioPrevista: nova.inicio || null,
      dataFimPrevista: nova.fim || null,
      dataViradaPrevista: nova.virada || null,
      responsavelClienteNome: ouNull(nova.responsavel),
      responsavelClienteEmail: ouNull(nova.email),
      observacao: ouNull(nova.observacao),
    }),
  );

// Fase e virada prevista.
const fase = reactive({ fase: '', virada: '' });
const opFases = computed(() => FASES_IMPLANTACAO.map((f) => ({ valor: f, rotulo: k(`fases.${f}`) })));
const faseAtual = computed(() => fase.fase || aberta.value?.fase || '');
const salvarFase = () =>
  tentar(() =>
    alterarImplantacao(aberta.value!.id, {
      fase: faseAtual.value as (typeof FASES_IMPLANTACAO)[number],
      dataViradaPrevista: fase.virada || aberta.value!.dataViradaPrevista,
      versao: aberta.value!.versao,
    }),
  );
const recontar = () =>
  tentar(
    () => recontarImplantacao(aberta.value!.id),
    (r) => {
      const c = r as { conferidos: number; alterados: number };
      aviso.value = k('recontados', { conferidos: c.conferidos, alterados: c.alterados });
    },
  );

// O que falta: os itens em aberto na ordem do resumo do domínio.
const porId = computed(() => new Map((painel.data.value?.itens ?? []).map((i) => [i.id, i])));
const falta = computed(() =>
  (painel.data.value?.resumo.oQueFalta ?? [])
    .map((id) => porId.value.get(id))
    .filter((i): i is ItemImplantacaoTela => !!i),
);
const concluidos = computed(() =>
  (painel.data.value?.itens ?? []).filter((i) => i.situacao === 'pronto' || i.situacao === 'dispensado'),
);

interface FormItem {
  situacao: string;
  prazo: string;
  responsavel: string;
  email: string;
  motivo: string;
}
const forms = reactive<Record<number, FormItem>>({});
const doItem = (i: ItemImplantacaoTela) =>
  (forms[i.id] ??= {
    situacao: i.situacao,
    prazo: i.dataPrazo ?? '',
    responsavel: i.responsavelNome ?? '',
    email: i.responsavelEmail ?? '',
    motivo: i.motivoDispensa ?? '',
  });
const opSituacoes = computed(() =>
  SITUACOES_ITEM_PRONTIDAO.map((s) => ({ valor: s, rotulo: k(`situacoes.${s}`) })),
);
function problemasItem(i: ItemImplantacaoTela): string[] {
  const f = doItem(i);
  return conferirMudancaItem(
    {
      tipo: i.modelo.tipo,
      quantidadeMinima: i.modelo.quantidadeMinima,
      contagem: i.quantidadeRealizada,
      situacao: i.situacao,
      dataInicioPrevista: i.dataInicioPrevista,
    },
    {
      situacao: f.situacao as ItemImplantacaoTela['situacao'],
      motivoDispensa: f.motivo,
      dataPrazo: f.prazo || null,
    },
  ).map((p) => p.mensagem);
}
const salvarItem = (i: ItemImplantacaoTela) => {
  const f = doItem(i);
  return tentar(
    () =>
      alterarItemImplantacao(i.id, {
        situacao: f.situacao as ItemImplantacaoTela['situacao'],
        motivoDispensa: f.situacao === 'dispensado' ? f.motivo.trim() : null,
        dataPrazo: f.prazo || null,
        responsavelNome: ouNull(f.responsavel),
        responsavelEmail: ouNull(f.email),
        versao: i.versao,
      }),
    () => delete forms[i.id],
  );
};
const contagemDe = (i: ItemImplantacaoTela) =>
  i.modelo.tipo === 'cadastro_minimo'
    ? `${i.quantidadeRealizada ?? 0}/${minimoEfetivo(i.modelo.quantidadeMinima)}`
    : k('semContagem');

// Metas: inclusão conferida na hora e medição.
const meta = reactive({ processo: '', indicador: 'adesao', valor: '', unidade: '', limite: '', modulo: '' });
const opIndicadores = computed(() =>
  INDICADORES_META.map((i) => ({ valor: i, rotulo: k(`indicadores.${i}`) })),
);
const problemasMeta = computed(() =>
  conferirMeta({
    processo: meta.processo,
    indicador: meta.indicador as (typeof INDICADORES_META)[number],
    valorMeta: meta.valor === '' ? Number.NaN : Number(meta.valor),
  }).map((p) => p.mensagem),
);
const incluirMeta = () =>
  tentar(
    () =>
      incluirMetaImplantacao(aberta.value!.id, {
        processo: meta.processo.trim(),
        indicador: meta.indicador as (typeof INDICADORES_META)[number],
        valorMeta: Number(meta.valor),
        unidade: ouNull(meta.unidade),
        dataLimite: meta.limite || null,
        modulo: ouNull(meta.modulo),
      }),
    () => Object.assign(meta, { processo: '', valor: '', unidade: '', limite: '' }),
  );
const medicoes = reactive<Record<number, { valor: string; analise: string }>>({});
const daMeta = (m: MetaImplantacaoTela) => (medicoes[m.id] ??= { valor: '', analise: '' });
const medir = (m: MetaImplantacaoTela) =>
  tentar(
    () =>
      medirMetaImplantacao(m.id, {
        valorMedido: Number(daMeta(m).valor),
        analise: ouNull(daMeta(m).analise),
        versao: m.versao,
      }),
    () => delete medicoes[m.id],
  );
const medidaValida = (m: MetaImplantacaoTela) => {
  const v = daMeta(m).valor;
  return v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
};

// Checklist padrão (plataforma): inclui ou ajusta pelo código.
const itemModelo = reactive({
  codigo: '',
  titulo: '',
  modulo: '',
  tipo: 'cadastro_minimo',
  entidade: '',
  minimo: '',
  critico: 'nao',
});
const opTipos = computed(() => TIPOS_VERIFICACAO.map((x) => ({ valor: x, rotulo: k(`tipos.${x}`) })));
const opContagens = computed(() => [
  { valor: '', rotulo: k('escolha') },
  ...(modelo.data.value?.contagens ?? []).map((c) => ({ valor: c, rotulo: c })),
]);
const opSimNao = computed(() => [
  { valor: 'nao', rotulo: k('nao') },
  { valor: 'sim', rotulo: k('sim') },
]);
const modeloValido = computed(
  () =>
    /^[A-Z0-9][A-Z0-9-]{2,29}$/.test(itemModelo.codigo.trim()) &&
    itemModelo.titulo.trim().length >= 3 &&
    itemModelo.modulo.trim().length >= 2 &&
    (itemModelo.tipo !== 'cadastro_minimo' || itemModelo.entidade !== ''),
);
const salvarModelo = () =>
  tentar(
    () =>
      salvarItemModelo({
        codigo: itemModelo.codigo.trim(),
        titulo: itemModelo.titulo.trim(),
        modulo: itemModelo.modulo.trim(),
        tipo: itemModelo.tipo as (typeof TIPOS_VERIFICACAO)[number],
        entidade: itemModelo.tipo === 'cadastro_minimo' ? itemModelo.entidade : null,
        quantidadeMinima: itemModelo.minimo ? Number(itemModelo.minimo) : null,
        critico: itemModelo.critico === 'sim',
        ativo: true,
      }),
    () => Object.assign(itemModelo, { codigo: '', titulo: '', entidade: '', minimo: '' }),
  );
</script>

<template>
  <section class="kit" data-testid="kit-implantacao" aria-labelledby="titulo-kit">
    <h1 id="titulo-kit">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <p v-if="painel.isLoading.value">{{ k('carregando') }}</p>
    <p v-if="erro" role="alert" class="erro" data-testid="kit-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="kit-aviso">{{ aviso }}</p>

    <template v-if="painel.data.value && !aberta">
      <h2>{{ k('diagnostico') }}</h2>
      <p>{{ k('diagnosticoTexto') }}</p>
      <table data-testid="kit-diagnostico">
        <thead>
          <tr>
            <th scope="col">{{ k('modulo') }}</th>
            <th scope="col">{{ k('item') }}</th>
            <th scope="col">{{ k('contagem') }}</th>
            <th scope="col">{{ k('situacaoItem') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in painel.data.value.diagnostico" :key="d.id" :data-testid="`kit-diag-${d.codigo}`">
            <td>{{ d.modulo }}</td>
            <td>
              {{ d.titulo }}<strong v-if="d.critico"> · {{ k('critico') }}</strong>
            </td>
            <td>
              <template v-if="d.contagem !== null"
                >{{ d.contagem }}/{{ minimoEfetivo(d.quantidadeMinima) }}</template
              >
              <template v-else>{{ k('semContagem') }}</template>
            </td>
            <td data-testid="kit-diag-situacao">{{ k(`situacoes.${d.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>

      <h2>{{ k('abrirTitulo') }}</h2>
      <form class="linha" data-testid="kit-abrir" @submit.prevent="abrir">
        <SanteCampoTexto v-model="nova.nome" :rotulo="k('nome')" :max-bytes="150" data-testid="kit-nome" />
        <label>{{ k('inicio') }} <input v-model="nova.inicio" type="date" data-testid="kit-inicio" /></label>
        <label>{{ k('fim') }} <input v-model="nova.fim" type="date" data-testid="kit-fim" /></label>
        <label>{{ k('virada') }} <input v-model="nova.virada" type="date" data-testid="kit-virada" /></label>
        <SanteCampoTexto v-model="nova.responsavel" :rotulo="k('responsavelCliente')" :max-bytes="150" />
        <SanteCampoTexto v-model="nova.email" :rotulo="k('emailResponsavel')" :max-bytes="254" />
        <SanteBotao
          tipo="submit"
          :rotulo="k('abrir')"
          :desabilitado="problemasAbrir.length > 0"
          data-testid="kit-abrir-gravar"
        />
      </form>
      <ul v-if="problemasAbrir.length && nova.nome" class="erro">
        <li v-for="p in problemasAbrir" :key="p">{{ p }}</li>
      </ul>
    </template>

    <template v-if="painel.data.value && aberta">
      <header class="cabeca">
        <h2 data-testid="kit-nome-aberta">{{ k('implantacao') }}: {{ aberta.nome }}</h2>
        <p data-testid="kit-percentual">
          <strong>{{ k('concluido', { percentual: painel.data.value.resumo.percentual }) }}</strong> ·
          {{
            k('totais', {
              prontos: painel.data.value.resumo.prontos,
              dispensados: painel.data.value.resumo.dispensados,
              emAndamento: painel.data.value.resumo.emAndamento,
              pendentes: painel.data.value.resumo.pendentes,
              criticos: painel.data.value.resumo.criticosEmAberto,
              atrasados: painel.data.value.resumo.atrasados,
            })
          }}
        </p>
        <div class="linha">
          <SanteSelecao
            :model-value="faseAtual"
            :rotulo="k('fase')"
            :opcoes="opFases"
            data-testid="kit-fase"
            @update:model-value="(v: string) => (fase.fase = v)"
          />
          <label>
            {{ k('virada') }}
            <input
              :value="fase.virada || aberta.dataViradaPrevista || ''"
              type="date"
              data-testid="kit-fase-virada"
              @input="fase.virada = ($event.target as HTMLInputElement).value"
            />
          </label>
          <SanteBotao :rotulo="k('alterarFase')" data-testid="kit-fase-gravar" @click="salvarFase" />
          <SanteBotao :rotulo="k('recontar')" data-testid="kit-recontar" @click="recontar" />
        </div>
      </header>

      <h2>{{ k('resumo') }}</h2>
      <ul class="modulos" data-testid="kit-resumo">
        <li
          v-for="m in painel.data.value.resumo.porModulo"
          :key="m.modulo"
          :data-testid="`kit-modulo-${m.modulo}`"
        >
          <span>{{ m.modulo }}</span>
          <progress :value="m.percentual" max="100" :aria-label="m.modulo">{{ m.percentual }}%</progress>
          <span>{{ m.concluidos }}/{{ m.total }} · {{ m.percentual }}%</span>
        </li>
      </ul>

      <h2>{{ k('oQueFalta') }}</h2>
      <p v-if="falta.length === 0" data-testid="kit-nada-falta">{{ k('nadaFalta') }}</p>
      <article
        v-for="i in falta"
        :key="i.id"
        class="item"
        :class="{ atrasado: i.atrasado }"
        :data-testid="`kit-item-${i.modelo.codigo}`"
      >
        <header>
          <strong>{{ i.modelo.modulo }} · {{ i.modelo.titulo }}</strong>
          <span v-if="i.modelo.critico" class="erro"> · {{ k('critico') }}</span>
          <span v-if="i.atrasado" class="erro" data-testid="kit-item-atrasado"> · {{ k('atrasado') }}</span>
          <span> · {{ contagemDe(i) }}</span>
          <span data-testid="kit-item-situacao"> · {{ k(`situacoes.${i.situacao}`) }}</span>
        </header>
        <p v-if="i.modelo.orientacao">{{ i.modelo.orientacao }}</p>
        <div class="linha">
          <SanteSelecao
            v-model="doItem(i).situacao"
            :rotulo="k('situacaoItem')"
            :opcoes="opSituacoes"
            data-testid="kit-item-nova-situacao"
          />
          <label>
            {{ k('prazo') }}
            <input v-model="doItem(i).prazo" type="date" data-testid="kit-item-prazo" />
          </label>
          <SanteCampoTexto
            v-model="doItem(i).responsavel"
            :rotulo="k('responsavel')"
            :max-bytes="150"
            data-testid="kit-item-responsavel"
          />
          <SanteCampoTexto v-model="doItem(i).email" :rotulo="k('emailItem')" :max-bytes="254" />
          <SanteCampoTexto
            v-if="doItem(i).situacao === 'dispensado'"
            v-model="doItem(i).motivo"
            :rotulo="k('motivoDispensa')"
            :max-bytes="500"
            data-testid="kit-item-motivo"
          />
          <SanteBotao
            :rotulo="k('salvarItem')"
            :desabilitado="problemasItem(i).length > 0"
            data-testid="kit-item-gravar"
            @click="salvarItem(i)"
          />
        </div>
        <ul v-if="problemasItem(i).length" class="erro" data-testid="kit-item-falta">
          <li v-for="p in problemasItem(i)" :key="p">{{ p }}</li>
        </ul>
      </article>

      <details v-if="concluidos.length">
        <summary>{{ k('concluidos') }} ({{ concluidos.length }})</summary>
        <ul data-testid="kit-concluidos">
          <li v-for="i in concluidos" :key="i.id">
            {{ i.modelo.modulo }} · {{ i.modelo.titulo }} · {{ k(`situacoes.${i.situacao}`) }}
            <template v-if="i.motivoDispensa"> ({{ i.motivoDispensa }})</template>
          </li>
        </ul>
      </details>

      <h2>{{ k('metas') }}</h2>
      <p v-if="painel.data.value.metas.length === 0">{{ k('semMetas') }}</p>
      <article
        v-for="m in painel.data.value.metas"
        :key="m.id"
        class="item"
        :data-testid="`kit-meta-${m.sequencia}`"
      >
        <header>
          <strong>{{ m.processo }}</strong> · {{ k(`indicadores.${m.indicador}`) }} · {{ k('valorMeta') }}
          {{ m.valorMeta }}{{ m.unidade ? ` ${m.unidade}` : '' }}
          <template v-if="m.valorMedido !== null"> · {{ k('valorMedido') }} {{ m.valorMedido }}</template>
          <span data-testid="kit-meta-situacao"> · {{ k(`situacoesMeta.${m.situacao}`) }}</span>
        </header>
        <div v-if="m.situacao !== 'cancelada'" class="linha">
          <SanteCampoTexto
            v-model="daMeta(m).valor"
            :rotulo="k('valorMedido')"
            :max-bytes="20"
            data-testid="kit-meta-valor"
          />
          <SanteCampoTexto v-model="daMeta(m).analise" :rotulo="k('analise')" :max-bytes="4000" />
          <SanteBotao
            :rotulo="k('medir')"
            :desabilitado="!medidaValida(m)"
            data-testid="kit-meta-medir"
            @click="medir(m)"
          />
        </div>
      </article>
      <form class="linha" data-testid="kit-nova-meta" @submit.prevent="incluirMeta">
        <SanteCampoTexto
          v-model="meta.processo"
          :rotulo="k('processo')"
          :max-bytes="150"
          data-testid="kit-meta-processo"
        />
        <SanteSelecao
          v-model="meta.indicador"
          :rotulo="k('indicador')"
          :opcoes="opIndicadores"
          data-testid="kit-meta-indicador"
        />
        <SanteCampoTexto
          v-model="meta.valor"
          :rotulo="k('valorMeta')"
          :max-bytes="20"
          data-testid="kit-meta-alvo"
        />
        <SanteCampoTexto v-model="meta.unidade" :rotulo="k('unidade')" :max-bytes="30" />
        <label
          >{{ k('dataLimite') }} <input v-model="meta.limite" type="date" data-testid="kit-meta-limite"
        /></label>
        <SanteBotao
          tipo="submit"
          :rotulo="k('incluirMeta')"
          :desabilitado="problemasMeta.length > 0"
          data-testid="kit-meta-incluir"
        />
      </form>
      <ul v-if="meta.processo && problemasMeta.length" class="erro">
        <li v-for="p in problemasMeta" :key="p">{{ p }}</li>
      </ul>
    </template>

    <details class="modelo" data-testid="kit-modelo">
      <summary>{{ k('modelo') }}</summary>
      <p>{{ k('modeloTexto') }}</p>
      <form class="linha" @submit.prevent="salvarModelo">
        <SanteCampoTexto
          v-model="itemModelo.codigo"
          data-testid="kit-modelo-codigo"
          :rotulo="k('codigo')"
          :max-bytes="30"
        />
        <SanteCampoTexto
          v-model="itemModelo.titulo"
          data-testid="kit-modelo-titulo"
          :rotulo="k('tituloItem')"
          :max-bytes="200"
        />
        <SanteCampoTexto
          v-model="itemModelo.modulo"
          data-testid="kit-modelo-modulo"
          :rotulo="k('modulo')"
          :max-bytes="30"
        />
        <SanteSelecao v-model="itemModelo.tipo" :rotulo="k('tipo')" :opcoes="opTipos" />
        <SanteSelecao
          v-if="itemModelo.tipo === 'cadastro_minimo'"
          v-model="itemModelo.entidade"
          data-testid="kit-modelo-entidade"
          :rotulo="k('entidade')"
          :opcoes="opContagens"
        />
        <SanteCampoTexto
          v-model="itemModelo.minimo"
          data-testid="kit-modelo-minimo"
          :rotulo="k('quantidadeMinima')"
          :max-bytes="6"
        />
        <SanteSelecao
          v-model="itemModelo.critico"
          data-testid="kit-modelo-critico"
          :rotulo="k('critico')"
          :opcoes="opSimNao"
        />
        <SanteBotao
          tipo="submit"
          data-testid="kit-modelo-salvar"
          :rotulo="k('salvarModelo')"
          :desabilitado="!modeloValido"
        />
      </form>
    </details>
  </section>
</template>

<style scoped>
.kit {
  display: grid;
  gap: 1rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.item {
  border: 1px solid var(--sgh-borda);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.atrasado {
  border-color: var(--sgh-alerta);
}
.modulos {
  display: grid;
  gap: 0.25rem;
  list-style: none;
  padding: 0;
}
.modulos li {
  display: grid;
  grid-template-columns: 10rem 1fr 8rem;
  gap: 0.5rem;
  align-items: center;
}
.erro {
  color: var(--sgh-alerta);
}
</style>
