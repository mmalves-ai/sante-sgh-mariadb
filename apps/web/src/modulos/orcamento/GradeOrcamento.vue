<script setup lang="ts">
// Grade dos valores por mês (M54, etapa 7): centro de custo × natureza × item gerencial × 12 meses, em reais (guardados
// em centavos). Filtro por centro e natureza (com busca, ADR 0027) e por texto; páginas de 40 linhas (a versão pode ter
// milhares); incluir linha (centro, natureza, item; total do ano opcional repartido em 12 meses); repetir o 1º mês e
// zerar a linha; o que mudou fica marcado e vai ao servidor com a versão lida (a linha zerada sai). Totais por natureza
// e por mês no rodapé, de todas as linhas (não só as do filtro). Só edita com `acoes.editar` (rascunho, permissão,
// liberação).
import {
  type ApoioOrcamento,
  CENTRO_SEM_CENTRO_ORCAMENTO,
  type ChaveLinhaOrcamento,
  NATUREZAS_ORCAMENTO,
  type NaturezaOrcamento,
  type OrcamentoDetalhe,
  ROTULO_CONSUMO_ITEM,
  ROTULO_SEM_CENTRO,
  ROTULOS_NATUREZA_ORCAMENTO,
  TETO_LINHAS_POR_GRAVACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarLinhasOrcamento } from './api-orcamento.js';
import {
  chaveItem,
  chaveLinha,
  entradaDaGrade,
  gradeDasLinhas,
  lerReais,
  linhaMudou,
  type LinhaGrade,
  mesesInvalidos,
  NOMES_MESES,
  normalizar,
  novaLinhaGrade,
  ordenarGrade,
  reais,
  repartirAno,
  repetirMes,
  totaisDaGrade,
  totalDaLinha,
} from './comum-orcamento.js';
import ErroOrcamento from './ErroOrcamento.vue';

const props = defineProps<{ detalhe: OrcamentoDetalhe; apoio: ApoioOrcamento }>();
const emit = defineEmits<{ gravado: [texto: string] }>();
const { t } = useI18n();
const POR_PAGINA = 40;

const centros = computed(() => new Map(props.apoio.centros.map((c) => [c.id, c])));
const itens = computed(
  () => new Map(props.apoio.itens.map((i) => [chaveItem(i.grupo, i.subgrupo, i.item), i])),
);
const codigoCentro = (id: number) =>
  id === CENTRO_SEM_CENTRO_ORCAMENTO ? -1 : (centros.value.get(id)?.codigo ?? id);
function rotuloCentro(id: number): string {
  if (id === CENTRO_SEM_CENTRO_ORCAMENTO) return ROTULO_SEM_CENTRO;
  const c = centros.value.get(id);
  return c ? `${c.codigo} · ${c.nome}` : `${id}`;
}
function rotuloItem(k: ChaveLinhaOrcamento): string {
  if (k.natureza === 'consumo') return ROTULO_CONSUMO_ITEM;
  const ch = chaveItem(k.grupo, k.subgrupo, k.item);
  const i = itens.value.get(ch);
  return i ? `${ch} · ${i.nome}` : ch;
}

const grade = reactive<LinhaGrade[]>(ordenarGrade(gradeDasLinhas(props.detalhe.linhas), codigoCentro));
const editavel = computed(() => props.detalhe.acoes.editar);

// Filtros.
const filtroCentro = ref<number | null>(null);
const filtroNatureza = ref<NaturezaOrcamento | ''>('');
const termo = ref('');
const pagina = ref(0);
const opcoesCentro = computed(() => [
  { valor: CENTRO_SEM_CENTRO_ORCAMENTO, rotulo: ROTULO_SEM_CENTRO },
  ...props.apoio.centros
    .filter((c) => c.ativo)
    .slice()
    .sort((a, b) => a.codigo - b.codigo)
    .map((c) => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` })),
]);
// O consumo de estoque é orçado pelo centro de custo de destino (sem a opção "sem centro").
const opcoesCentroInclusao = computed(() =>
  novaNatureza.value === 'consumo'
    ? opcoesCentro.value.filter((o) => o.valor !== CENTRO_SEM_CENTRO_ORCAMENTO)
    : opcoesCentro.value,
);
const opcoesFiltroCentro = computed(() => [
  { valor: null, rotulo: t('orcamentoEmpresarial.grade.todos') },
  ...opcoesCentro.value,
]);
const opcoesNatureza = NATUREZAS_ORCAMENTO.map((n) => ({ valor: n, rotulo: ROTULOS_NATUREZA_ORCAMENTO[n] }));
const opcoesFiltroNatureza = computed(() => [
  { valor: '' as const, rotulo: t('orcamentoEmpresarial.grade.todas') },
  ...opcoesNatureza,
]);
const filtradas = computed(() => {
  const q = normalizar(termo.value.trim());
  return grade.filter(
    (l) =>
      (filtroCentro.value === null || l.centro === filtroCentro.value) &&
      (filtroNatureza.value === '' || l.natureza === filtroNatureza.value) &&
      (!q || normalizar(`${rotuloCentro(l.centro)} ${rotuloItem(l)}`).includes(q)),
  );
});
const paginas = computed(() => Math.max(1, Math.ceil(filtradas.value.length / POR_PAGINA)));
const visiveis = computed(() => {
  const p = Math.min(pagina.value, paginas.value - 1);
  return filtradas.value.slice(p * POR_PAGINA, (p + 1) * POR_PAGINA);
});
const inicio = computed(() => Math.min(pagina.value, paginas.value - 1) * POR_PAGINA);
function filtrar(): void {
  pagina.value = 0;
}

// Incluir linha.
const novoCentro = ref<number>(CENTRO_SEM_CENTRO_ORCAMENTO);
const novaNatureza = ref<NaturezaOrcamento>('despesa');
const novoItem = ref<string | null>(null);
const novoAnual = ref('');
const avisoInclusao = ref<string | null>(null);
const opcoesItem = computed(() =>
  props.apoio.itens
    .filter((i) => i.ativo && i.natureza === novaNatureza.value)
    .map((i) => ({
      valor: chaveItem(i.grupo, i.subgrupo, i.item),
      rotulo: `${chaveItem(i.grupo, i.subgrupo, i.item)} · ${i.nome} (${i.grupoNome})`,
    })),
);
const anualCentavos = computed(() => lerReais(novoAnual.value));
function aoTrocarNatureza(): void {
  novoItem.value = null;
  if (novaNatureza.value === 'consumo' && novoCentro.value === CENTRO_SEM_CENTRO_ORCAMENTO)
    novoCentro.value = opcoesCentroInclusao.value[0]?.valor ?? CENTRO_SEM_CENTRO_ORCAMENTO;
}
function incluir(): void {
  avisoInclusao.value = null;
  let g = 0;
  let s = 0;
  let i = 0;
  if (novaNatureza.value === 'consumo' && novoCentro.value === CENTRO_SEM_CENTRO_ORCAMENTO) {
    avisoInclusao.value = t('orcamentoEmpresarial.grade.incluir.consumoSemCentro');
    return;
  }
  if (novaNatureza.value !== 'consumo') {
    if (!novoItem.value) {
      avisoInclusao.value = t('orcamentoEmpresarial.grade.incluir.escolhaItem');
      return;
    }
    [g, s, i] = novoItem.value.split('.').map(Number) as [number, number, number];
  }
  const k: ChaveLinhaOrcamento = {
    centro: novoCentro.value,
    natureza: novaNatureza.value,
    grupo: g,
    subgrupo: s,
    item: i,
  };
  if (grade.some((l) => chaveLinha(l) === chaveLinha(k))) {
    avisoInclusao.value = t('orcamentoEmpresarial.grade.incluir.jaExiste');
    return;
  }
  if (anualCentavos.value === null) return;
  const nova = novaLinhaGrade(k);
  if (anualCentavos.value > 0) repartirAno(nova, anualCentavos.value);
  grade.push(nova);
  ordenarGrade(grade, codigoCentro);
  // Mostra a linha incluída: o filtro passa a ser o centro dela.
  filtroCentro.value = k.centro;
  filtroNatureza.value = '';
  termo.value = '';
  const pos = filtradas.value.findIndex((l) => chaveLinha(l) === chaveLinha(k));
  pagina.value = Math.max(0, Math.floor(pos / POR_PAGINA));
  novoAnual.value = '';
}

// O que mudou e a gravação.
const entrada = computed(() => entradaDaGrade(grade));
const totais = computed(() => totaisDaGrade(grade));
const gravando = ref(false);
const erro = ref<unknown>(null);
let versao = props.detalhe.orcamento.versao;

function zerar(l: LinhaGrade): void {
  for (let i = 0; i < l.textos.length; i++) l.textos[i] = reais(0);
}
function desfazer(): void {
  const lidas = ordenarGrade(gradeDasLinhas(props.detalhe.linhas), codigoCentro);
  grade.splice(0, grade.length, ...lidas);
}

async function gravar(): Promise<void> {
  const e = entrada.value;
  if (gravando.value || e.invalidas > 0 || e.linhas.length === 0) return;
  gravando.value = true;
  erro.value = null;
  try {
    let incluidas = 0;
    let alteradas = 0;
    let removidas = 0;
    let antes: number | null = null;
    let depois = 0;
    for (let i = 0; i < e.linhas.length; i += TETO_LINHAS_POR_GRAVACAO) {
      const r = await gravarLinhasOrcamento(props.detalhe.orcamento.id, {
        versao,
        linhas: e.linhas.slice(i, i + TETO_LINHAS_POR_GRAVACAO),
      });
      versao = r.versao;
      incluidas += r.incluidas;
      alteradas += r.alteradas;
      removidas += r.removidas;
      antes ??= r.totalAntes;
      depois = r.totalDepois;
    }
    emit(
      'gravado',
      t('orcamentoEmpresarial.grade.gravado', {
        incluidas,
        alteradas,
        removidas,
        antes: reais(antes ?? 0),
        depois: reais(depois),
      }),
    );
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}

const rotuloMes = (m: number, l: LinhaGrade) =>
  t('orcamentoEmpresarial.grade.mesRotulo', {
    mes: NOMES_MESES[m]!,
    centro: rotuloCentro(l.centro),
    item: rotuloItem(l),
  });
const textoInvalidos = (l: LinhaGrade) =>
  t('orcamentoEmpresarial.grade.invalido', {
    meses: mesesInvalidos(l)
      .map((m) => NOMES_MESES[m])
      .join(', '),
  });
</script>

<template>
  <section class="bloco" aria-labelledby="orc-grade-titulo" data-testid="orc-grade">
    <h3 id="orc-grade-titulo">{{ t('orcamentoEmpresarial.grade.titulo') }}</h3>
    <p class="secundario">{{ t('orcamentoEmpresarial.grade.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="filtroCentro"
        :rotulo="t('orcamentoEmpresarial.grade.filtroCentro')"
        :opcoes="opcoesFiltroCentro"
        busca
        data-testid="orc-filtro-centro"
        @update:model-value="filtrar"
      />
      <SanteSelecao
        v-model="filtroNatureza"
        :rotulo="t('orcamentoEmpresarial.grade.filtroNatureza')"
        :opcoes="opcoesFiltroNatureza"
        data-testid="orc-filtro-natureza"
        @update:model-value="filtrar"
      />
      <label class="campo-numero">
        <span>{{ t('orcamentoEmpresarial.grade.filtroTermo') }}</span>
        <input v-model="termo" type="search" maxlength="60" data-testid="orc-filtro-termo" @input="filtrar" />
      </label>
    </div>

    <form
      v-if="editavel"
      class="bloco"
      :aria-label="t('orcamentoEmpresarial.grade.incluir.titulo')"
      data-testid="orc-form-incluir"
      @submit.prevent="incluir"
    >
      <h4>{{ t('orcamentoEmpresarial.grade.incluir.titulo') }}</h4>
      <div class="campos">
        <SanteSelecao
          v-model="novoCentro"
          :rotulo="t('orcamentoEmpresarial.grade.incluir.centro')"
          :opcoes="opcoesCentroInclusao"
          busca
          obrigatorio
          data-testid="orc-incluir-centro"
        />
        <SanteSelecao
          v-model="novaNatureza"
          :rotulo="t('orcamentoEmpresarial.grade.incluir.natureza')"
          :opcoes="opcoesNatureza"
          obrigatorio
          data-testid="orc-incluir-natureza"
          @update:model-value="aoTrocarNatureza"
        />
        <SanteSelecao
          v-if="novaNatureza !== 'consumo'"
          v-model="novoItem"
          :rotulo="t('orcamentoEmpresarial.grade.incluir.item')"
          :opcoes="opcoesItem"
          busca
          obrigatorio
          data-testid="orc-incluir-item"
        />
        <p v-else class="secundario">{{ t('orcamentoEmpresarial.grade.incluir.semItem') }}</p>
        <label class="campo-numero">
          <span>{{ t('orcamentoEmpresarial.grade.incluir.anual') }}</span>
          <input
            v-model="novoAnual"
            inputmode="decimal"
            maxlength="20"
            :aria-invalid="anualCentavos === null"
            data-testid="orc-incluir-anual"
          />
        </label>
      </div>
      <SanteAlerta
        v-if="avisoInclusao"
        :texto="avisoInclusao"
        variante="aviso"
        anunciar
        data-testid="orc-incluir-aviso"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.grade.incluir.incluir')"
          tipo="submit"
          variante="secundario"
          :desabilitado="anualCentavos === null"
          data-testid="orc-incluir"
        />
      </div>
    </form>

    <p v-if="grade.length === 0" data-testid="orc-grade-vazia">{{ t('orcamentoEmpresarial.grade.vazia') }}</p>
    <p v-else-if="filtradas.length === 0" data-testid="orc-grade-nenhuma">
      {{ t('orcamentoEmpresarial.grade.nenhuma') }}
    </p>
    <div v-if="grade.length" class="rolagem">
      <table class="tabela grade" data-testid="orc-tabela-grade">
        <caption class="secundario">
          {{
            t('orcamentoEmpresarial.grade.pagina', {
              de: filtradas.length ? inicio + 1 : 0,
              ate: inicio + visiveis.length,
              total: filtradas.length,
            })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="fixa">
              {{ t('orcamentoEmpresarial.grade.colunas.centro') }} /
              {{ t('orcamentoEmpresarial.grade.colunas.item') }}
            </th>
            <th v-for="m in NOMES_MESES" :key="m" scope="col" class="numero">{{ m }}</th>
            <th scope="col" class="numero">{{ t('orcamentoEmpresarial.grade.colunas.total') }}</th>
            <th v-if="editavel" scope="col">{{ t('orcamentoEmpresarial.grade.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in visiveis"
            :key="chaveLinha(l)"
            :class="{ mudou: linhaMudou(l) }"
            :data-testid="`orc-linha-${chaveLinha(l)}`"
          >
            <th scope="row" class="fixa">
              {{ rotuloCentro(l.centro) }}
              <div class="secundario">{{ ROTULOS_NATUREZA_ORCAMENTO[l.natureza] }} · {{ rotuloItem(l) }}</div>
              <div v-if="mesesInvalidos(l).length" class="secundario" role="alert">
                {{ textoInvalidos(l) }}
              </div>
            </th>
            <td v-for="(_, m) in l.textos" :key="m" class="numero">
              <input
                v-if="editavel"
                v-model="l.textos[m]"
                inputmode="decimal"
                maxlength="20"
                :aria-label="rotuloMes(m, l)"
                :aria-invalid="lerReais(l.textos[m] ?? '') === null"
                :data-testid="`orc-mes-${chaveLinha(l)}-${m + 1}`"
              />
              <template v-else>{{ reais(lerReais(l.textos[m] ?? '') ?? 0) }}</template>
            </td>
            <td class="numero total" :data-testid="`orc-total-${chaveLinha(l)}`">
              {{ reais(totalDaLinha(l)) }}
            </td>
            <td v-if="editavel">
              <div class="acoes">
                <SanteBotao
                  :rotulo="t('orcamentoEmpresarial.grade.repetir')"
                  variante="texto"
                  :aria-label="
                    t('orcamentoEmpresarial.grade.repetirRotulo', {
                      centro: rotuloCentro(l.centro),
                      item: rotuloItem(l),
                    })
                  "
                  :data-testid="`orc-repetir-${chaveLinha(l)}`"
                  @acionar="repetirMes(l, 0)"
                />
                <SanteBotao
                  :rotulo="t('orcamentoEmpresarial.grade.zerar')"
                  variante="texto"
                  :aria-label="
                    t('orcamentoEmpresarial.grade.zerarRotulo', {
                      centro: rotuloCentro(l.centro),
                      item: rotuloItem(l),
                    })
                  "
                  :data-testid="`orc-zerar-${chaveLinha(l)}`"
                  @acionar="zerar(l)"
                />
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr
            v-for="n in NATUREZAS_ORCAMENTO"
            v-show="totais[n].linhas > 0"
            :key="n"
            class="total"
            :data-testid="`orc-total-natureza-${n}`"
          >
            <th scope="row" class="fixa">
              {{
                t('orcamentoEmpresarial.grade.totalNatureza', {
                  natureza: ROTULOS_NATUREZA_ORCAMENTO[n],
                  linhas: totais[n].linhas,
                  total: reais(totais[n].ano),
                })
              }}
            </th>
            <td v-for="(v, m) in totais[n].meses" :key="m" class="numero">{{ reais(v) }}</td>
            <td class="numero">{{ reais(totais[n].ano) }}</td>
            <td v-if="editavel" />
          </tr>
        </tfoot>
      </table>
    </div>
    <div v-if="paginas > 1" class="acoes">
      <SanteBotao
        :rotulo="t('orcamentoEmpresarial.grade.anterior')"
        variante="secundario"
        :desabilitado="pagina === 0"
        data-testid="orc-grade-anterior"
        @acionar="pagina = Math.max(0, pagina - 1)"
      />
      <SanteBotao
        :rotulo="t('orcamentoEmpresarial.grade.proxima')"
        variante="secundario"
        :desabilitado="pagina >= paginas - 1"
        data-testid="orc-grade-proxima"
        @acionar="pagina = Math.min(paginas - 1, pagina + 1)"
      />
    </div>

    <template v-if="editavel">
      <p v-if="entrada.invalidas" class="secundario" role="alert" data-testid="orc-invalidas">
        {{ t('orcamentoEmpresarial.grade.invalidas', { n: entrada.invalidas }) }}
      </p>
      <p class="secundario" role="status" data-testid="orc-pendentes">
        {{
          entrada.linhas.length
            ? t('orcamentoEmpresarial.grade.pendentes', { n: entrada.linhas.length })
            : t('orcamentoEmpresarial.grade.semAlteracao')
        }}
      </p>
      <ErroOrcamento v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="
            gravando ? t('orcamentoEmpresarial.grade.gravando') : t('orcamentoEmpresarial.grade.gravar')
          "
          :desabilitado="gravando || entrada.invalidas > 0 || entrada.linhas.length === 0"
          data-testid="orc-gravar"
          @acionar="gravar"
        />
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.grade.desfazer')"
          variante="texto"
          :desabilitado="gravando || (entrada.linhas.length === 0 && entrada.invalidas === 0)"
          data-testid="orc-desfazer"
          @acionar="desfazer"
        />
      </div>
    </template>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
