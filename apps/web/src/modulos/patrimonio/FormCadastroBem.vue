<script setup lang="ts">
// Cadastro do bem em passos (regra 11: o bem nasce do documento de origem). 1. Documento: a nota fiscal de entrada do
// mês (busca, nota, item com as unidades ainda sem bem) ou a doação com o termo (número, data, doador, empresa, valor).
// 2. Dados: descrição, grupo (vida útil padrão impressa), origem, setor, responsável, plaqueta (vazio: o Sante numera),
// depreciação. 3. Conferir e gravar: o resumo com o valor de cada unidade; o resultado lista as plaquetas criadas.
import {
  type ApoioPatrimonio,
  type BemPatrimonial,
  GRUPOS_BEM,
  type GrupoBem,
  type GrupoSemente,
  type ItemNotaParaBem,
  ORIGEM_BEM_DOACAO,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SantePassos, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { cadastrarBens, lerItensDaNota, lerNotas } from './api-patrimonio.js';
import {
  centavosOuZero,
  competenciasAte,
  corpoDoCadastro,
  dataBr,
  problemasDoCadastro,
  rascunhoDoItem,
  rascunhoVazio,
  reais,
  rotuloCentro,
  rotuloCompetencia,
} from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ apoio: ApoioPatrimonio; hoje: string }>();
const emit = defineEmits<{ abrir: [id: number] }>();
const { t } = useI18n();
const cliente = useQueryClient();

type Passo = 'documento' | 'dados' | 'conferir';
const passo = ref<Passo>('documento');
const passos = computed(() =>
  (['documento', 'dados', 'conferir'] as const).map((p) => ({
    valor: p,
    rotulo: t(`patrimonio.cadastro.passos.${p}`),
  })),
);

const r = ref(rascunhoVazio());
const quantidadeTexto = ref('1');
watch(quantidadeTexto, (q) => {
  const n = Number(q.trim());
  r.value.quantidade = Number.isInteger(n) ? n : 0;
});

// ── Passo 1: a nota do mês ou o termo ───────────────────────────────────────────────────────────────────────────────
const competencias = computed(() => competenciasAte(props.hoje, 24));
const competencia = ref(props.hoje.slice(0, 7));
const buscaNota = ref('');
const buscaAplicada = ref('');
const notas = useQuery({
  queryKey: computed(() => ['patrimonio', 'notas', competencia.value, buscaAplicada.value]),
  queryFn: () => lerNotas(competencia.value, buscaAplicada.value || null),
  enabled: computed(() => r.value.documento === 'nota'),
});
const notaAberta = ref<number | null>(null);
const itens = useQuery({
  queryKey: computed(() => ['patrimonio', 'itens-nota', notaAberta.value]),
  queryFn: () => lerItensDaNota(notaAberta.value!),
  enabled: computed(() => notaAberta.value !== null),
});
const itemEscolhido = ref<ItemNotaParaBem | null>(null);
function escolherItem(i: ItemNotaParaBem) {
  if (notaAberta.value === null) return;
  itemEscolhido.value = i;
  r.value = rascunhoDoItem(r.value, notaAberta.value, i);
  quantidadeTexto.value = String(r.value.quantidade);
}
watch(
  () => r.value.documento,
  (d) => {
    if (d === 'termo') {
      itemEscolhido.value = null;
      r.value.nota = null;
      r.value.itemNota = null;
      if (r.value.origem === null && props.apoio.origens.some((o) => o.id === ORIGEM_BEM_DOACAO))
        r.value.origem = ORIGEM_BEM_DOACAO;
    }
  },
);

// ── Passo 2: dados ──────────────────────────────────────────────────────────────────────────────────────────────────
const opcoesGrupo = computed(() =>
  props.apoio.grupos.filter((g) => g.ativo).map((g) => ({ valor: g.valor as GrupoBem, rotulo: g.rotulo })),
);
const opcoesOrigem = computed(() =>
  props.apoio.origens.map((o) => ({ valor: o.id as number | null, rotulo: o.nome })),
);
const opcoesCentro = computed(() =>
  props.apoio.centros
    .filter((c) => c.ativo)
    .map((c) => ({ valor: c.id as number | null, rotulo: rotuloCentro(c) })),
);
const opcoesTipoResp = computed(() => [
  { valor: null as number | null, rotulo: '—' },
  ...props.apoio.tiposResponsavel.map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const opcoesCoef = computed(() => [
  { valor: null as number | null, rotulo: t('patrimonio.ficha.umTurno') },
  ...props.apoio.coeficientes.map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.descricao} (${c.percentual}%)`,
  })),
]);
const opcoesEmpresa = computed(() =>
  props.apoio.empresas.map((e) => ({ valor: e.id as number | null, rotulo: e.nome })),
);
// W0-08: a vida útil padrão é a do grupo no cadastro (apoio); sem ele, a da semente.
const vidaPadrao = computed(
  () =>
    props.apoio.grupos.find((g) => g.valor === r.value.grupo)?.vidaUtilMeses ??
    (r.value.grupo in GRUPOS_BEM ? GRUPOS_BEM[r.value.grupo as GrupoSemente].vidaUtilMeses : 120),
);

// ── Passo 3: conferir e gravar ──────────────────────────────────────────────────────────────────────────────────────
const problemas = computed(() => problemasDoCadastro(r.value, itemEscolhido.value));
const valorUnidade = computed(() =>
  r.value.documento === 'nota'
    ? (itemEscolhido.value?.valorUnitarioCent ?? 0)
    : (centavosOuZero(r.value.valor) ?? 0),
);
const setorNome = computed(() =>
  rotuloCentro(props.apoio.centros.find((c) => c.id === r.value.centro) ?? null),
);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const gravados = ref<BemPatrimonial[] | null>(null);
async function gravar() {
  if (problemas.value.length > 0) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const x = await cadastrarBens(corpoDoCadastro(r.value));
    gravados.value = x.bens;
    await cliente.invalidateQueries({ queryKey: ['patrimonio'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
function novo() {
  r.value = rascunhoVazio();
  quantidadeTexto.value = '1';
  itemEscolhido.value = null;
  notaAberta.value = null;
  gravados.value = null;
  erro.value = null;
  passo.value = 'documento';
}
</script>

<template>
  <section class="bloco" aria-labelledby="cadastro-bem-titulo" data-testid="form-cadastro-bem">
    <h2 id="cadastro-bem-titulo">{{ t('patrimonio.bens.abas.cadastrar') }}</h2>
    <template v-if="gravados">
      <p role="status" class="ok" data-testid="cadastro-gravado">
        {{
          t('patrimonio.cadastro.gravados', {
            n: gravados.length,
            plaquetas: gravados.map((b) => b.plaqueta).join(', '),
          })
        }}
      </p>
      <div class="acoes">
        <SanteBotao
          v-for="b in gravados.slice(0, 10)"
          :key="b.id"
          variante="secundario"
          :rotulo="`${t('patrimonio.abrir')} ${b.plaqueta}`"
          :data-testid="`cadastro-abrir-${b.id}`"
          @acionar="emit('abrir', b.id)"
        />
        <SanteBotao :rotulo="t('patrimonio.cadastro.novo')" data-testid="cadastro-novo" @acionar="novo" />
      </div>
    </template>
    <template v-else>
      <SantePassos v-model="passo" :passos="passos" />

      <!-- 1. Documento de origem -->
      <div v-if="passo === 'documento'" class="bloco" data-testid="cadastro-passo-documento">
        <SanteOpcoes
          v-model="r.documento"
          :legenda="t('patrimonio.cadastro.documento')"
          :opcoes="[
            { valor: 'nota', rotulo: t('patrimonio.cadastro.documentos.nota') },
            { valor: 'termo', rotulo: t('patrimonio.cadastro.documentos.termo') },
          ]"
          nome="documento-origem"
          data-testid="cadastro-documento"
        />
        <template v-if="r.documento === 'nota'">
          <div class="campos">
            <SanteSelecao
              v-model="competencia"
              :rotulo="t('patrimonio.cadastro.competenciaNotas')"
              :opcoes="competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }))"
              busca
              data-testid="cadastro-competencia"
            />
            <SanteCampoTexto
              v-model="buscaNota"
              :rotulo="t('patrimonio.cadastro.buscaNota')"
              :max-bytes="40"
              data-testid="cadastro-busca-nota"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('patrimonio.bens.filtrar')"
              data-testid="cadastro-buscar-nota"
              @acionar="buscaAplicada = buscaNota.trim()"
            />
          </div>
          <MensagemErro v-if="notas.isError.value" :erro="notas.error.value" />
          <p v-else-if="!notas.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
          <p v-else-if="notas.data.value.notas.length === 0" data-testid="cadastro-sem-notas">
            {{ t('patrimonio.cadastro.semNotas') }}
          </p>
          <template v-else>
            <p v-if="notas.data.value.truncado" class="secundario">{{ t('patrimonio.cadastro.truncado') }}</p>
            <ul class="lista-notas" :aria-label="t('patrimonio.cadastro.notas')">
              <li v-for="n in notas.data.value.notas" :key="n.id" :data-testid="`nota-${n.id}`">
                <span>{{
                  t('patrimonio.cadastro.notaLinha', {
                    numero: n.numero ?? n.doc,
                    serie: n.serie ? `/${n.serie}` : '',
                    data: dataBr(n.data),
                    fornecedor: n.fornecedor ?? '—',
                    total: reais(n.totalCent),
                    itens: n.itens,
                  })
                }}</span>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('patrimonio.cadastro.escolherNota')"
                  :data-testid="`nota-escolher-${n.id}`"
                  @acionar="notaAberta = n.id"
                />
              </li>
            </ul>
          </template>
          <template v-if="notaAberta !== null">
            <MensagemErro v-if="itens.isError.value" :erro="itens.error.value" />
            <p v-else-if="!itens.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
            <div v-else class="rolagem">
              <table class="tabela" data-testid="tabela-itens-nota">
                <caption class="secundario">
                  {{
                    t('patrimonio.cadastro.itens')
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t('patrimonio.cadastro.item') }}</th>
                    <th scope="col">{{ t('patrimonio.cadastro.quantidade') }}</th>
                    <th scope="col">{{ t('patrimonio.cadastro.valorUnitario') }}</th>
                    <th scope="col">{{ t('patrimonio.cadastro.jaCadastrados') }}</th>
                    <th scope="col">{{ t('patrimonio.cadastro.disponiveis') }}</th>
                    <th scope="col">{{ t('patrimonio.acoes') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="i in itens.data.value.itens" :key="i.id" :data-testid="`item-nota-${i.id}`">
                    <td>{{ i.nome }}</td>
                    <td>{{ i.quantidade }}</td>
                    <td>{{ reais(i.valorUnitarioCent) }}</td>
                    <td>{{ i.jaCadastrados }}</td>
                    <td>{{ i.disponiveis }}</td>
                    <td>
                      <SanteBotao
                        variante="secundario"
                        :rotulo="t('patrimonio.cadastro.escolherItem')"
                        :desabilitado="i.disponiveis < 1"
                        :data-testid="`item-escolher-${i.id}`"
                        @acionar="escolherItem(i)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <p v-if="itemEscolhido" role="status" data-testid="cadastro-item-escolhido">
            {{
              t('patrimonio.cadastro.itemEscolhido', {
                nome: itemEscolhido.nome,
                disponiveis: itemEscolhido.disponiveis,
                valor: reais(itemEscolhido.valorUnitarioCent),
              })
            }}
          </p>
        </template>
        <div v-else class="campos">
          <SanteCampoTexto
            v-model="r.termoNumero"
            :rotulo="t('patrimonio.cadastro.termoNumero')"
            :max-bytes="40"
            obrigatorio
            data-testid="cadastro-termo-numero"
          />
          <SanteData
            v-model="r.termoData"
            :rotulo="t('patrimonio.cadastro.termoData')"
            editavel
            :maximo="hoje"
            data-testid="cadastro-termo-data"
          />
          <SanteCampoTexto
            v-model="r.doador"
            :rotulo="t('patrimonio.cadastro.doador')"
            :max-bytes="120"
            obrigatorio
            data-testid="cadastro-doador"
          />
          <SanteSelecao
            v-model="r.empresa"
            :rotulo="t('patrimonio.empresa')"
            :opcoes="opcoesEmpresa"
            busca
            data-testid="cadastro-empresa"
          />
          <SanteData
            v-model="r.dataAquisicao"
            :rotulo="t('patrimonio.cadastro.dataAquisicao')"
            editavel
            :maximo="hoje"
            data-testid="cadastro-data-aquisicao"
          />
          <SanteCampoTexto
            v-model="r.valor"
            :rotulo="t('patrimonio.cadastro.valorUnidade')"
            :max-bytes="20"
            obrigatorio
            data-testid="cadastro-valor"
          />
        </div>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('patrimonio.avancar')"
            data-testid="cadastro-ir-dados"
            @acionar="passo = 'dados'"
          />
        </div>
      </div>

      <!-- 2. Dados do bem -->
      <div v-else-if="passo === 'dados'" class="bloco" data-testid="cadastro-passo-dados">
        <div class="campos">
          <SanteCampoTexto
            v-model="r.descricao"
            :rotulo="t('patrimonio.bens.descricaoBem')"
            :max-bytes="120"
            obrigatorio
            data-testid="cadastro-descricao"
          />
          <SanteSelecao
            v-model="r.grupo"
            :rotulo="t('patrimonio.bens.grupo')"
            :opcoes="opcoesGrupo"
            busca
            data-testid="cadastro-grupo"
          />
          <SanteSelecao
            v-model="r.origem"
            :rotulo="t('patrimonio.cadastro.origem')"
            :opcoes="opcoesOrigem"
            busca
            data-testid="cadastro-origem"
          />
          <SanteSelecao
            v-model="r.centro"
            :rotulo="t('patrimonio.cadastro.centro')"
            :opcoes="opcoesCentro"
            busca
            data-testid="cadastro-centro"
          />
          <SanteCampoTexto
            v-model="r.localDetalhe"
            :rotulo="t('patrimonio.cadastro.localDetalhe')"
            :max-bytes="80"
            data-testid="cadastro-local"
          />
          <SanteSelecao
            v-model="r.tipoResponsavel"
            :rotulo="t('patrimonio.cadastro.tipoResponsavel')"
            :opcoes="opcoesTipoResp"
            busca
            data-testid="cadastro-tipo-responsavel"
          />
          <SanteCampoTexto
            v-model="r.responsavel"
            :rotulo="t('patrimonio.cadastro.responsavel')"
            :max-bytes="80"
            data-testid="cadastro-responsavel"
          />
          <SanteCampoTexto
            v-model="r.marca"
            :rotulo="t('patrimonio.cadastro.marca')"
            :max-bytes="40"
            data-testid="cadastro-marca"
          />
          <SanteCampoTexto
            v-model="r.modelo"
            :rotulo="t('patrimonio.cadastro.modelo')"
            :max-bytes="40"
            data-testid="cadastro-modelo"
          />
          <SanteCampoTexto
            v-model="quantidadeTexto"
            :rotulo="t('patrimonio.cadastro.unidades')"
            :max-bytes="3"
            data-testid="cadastro-quantidade"
          />
          <SanteCampoTexto
            v-model="r.numeroSerie"
            :rotulo="t('patrimonio.cadastro.numeroSerie')"
            :max-bytes="40"
            data-testid="cadastro-serie"
          />
          <SanteCampoTexto
            v-model="r.plaqueta"
            :rotulo="t('patrimonio.cadastro.plaqueta')"
            :max-bytes="20"
            data-testid="cadastro-plaqueta"
          />
          <SanteCampoTexto
            v-model="r.vidaUtilMeses"
            :rotulo="t('patrimonio.cadastro.vidaUtil', { n: vidaPadrao })"
            :max-bytes="4"
            data-testid="cadastro-vida-util"
          />
          <SanteCampoTexto
            v-model="r.residual"
            :rotulo="t('patrimonio.cadastro.residual')"
            :max-bytes="20"
            data-testid="cadastro-residual"
          />
          <SanteSelecao
            v-model="r.coeficiente"
            :rotulo="t('patrimonio.cadastro.coeficiente')"
            :opcoes="opcoesCoef"
            data-testid="cadastro-coeficiente"
          />
          <SanteCampoTexto
            v-model="r.inicioDepreciacao"
            :rotulo="t('patrimonio.cadastro.inicio')"
            :max-bytes="7"
            data-testid="cadastro-inicio"
          />
        </div>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.voltar')" @acionar="passo = 'documento'" />
          <SanteBotao
            :rotulo="t('patrimonio.avancar')"
            data-testid="cadastro-ir-conferir"
            @acionar="passo = 'conferir'"
          />
        </div>
      </div>

      <!-- 3. Conferir e gravar -->
      <div v-else class="bloco" data-testid="cadastro-passo-conferir">
        <p data-testid="cadastro-resumo">
          {{
            t('patrimonio.cadastro.resumo', {
              n: r.quantidade,
              valor: reais(valorUnidade),
              setor: setorNome || '—',
            })
          }}
        </p>
        <ul v-if="problemas.length > 0" class="erro" data-testid="cadastro-problemas">
          <li v-for="p in problemas" :key="p">{{ t(`patrimonio.cadastro.problemas.${p}`) }}</li>
        </ul>
        <ErroPatrimonio v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.voltar')" @acionar="passo = 'dados'" />
          <SanteBotao
            :rotulo="t('patrimonio.cadastro.gravar')"
            :desabilitado="ocupado || problemas.length > 0 || !apoio.acoes.cadastrar"
            data-testid="cadastro-gravar"
            @acionar="gravar"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
<style scoped>
.lista-notas {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lista-notas li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
}
</style>
