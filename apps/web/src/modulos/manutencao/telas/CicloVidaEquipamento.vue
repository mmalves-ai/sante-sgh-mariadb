<script setup lang="ts">
// W0-08, parte 9 (mercado M3; RDC 509/2021, arts. 8º, 15 e 16): na ficha do equipamento, os cursos do treinamento
// exigidos para operar o MODELO (fabricante + modelo; o catálogo é do treinamento, só leitura), quem está apto e quem
// está pendente, o índice de obsolescência com as três parcelas e a conta impressa, os eventos do ciclo de vida
// (incorporação, desativação e descarte: só inclusão, nunca editados) e o plano de gerenciamento das tecnologias (PGTS)
// em PDF, gerado do cadastro. A seção carrega só quando aberta. A tela confere pelo mesmo esquema do servidor.
import {
  CODIGOS_DESTINO_DESCARTE,
  CODIGOS_TIPO_EVENTO_CICLO,
  DESTINOS_DESCARTE,
  esquemaRegistrarEventoCiclo,
  esquemaVincularCursoModelo,
  FAIXAS_OBSOLESCENCIA,
  TIPOS_EVENTO_CICLO,
  type ApoioManutencao,
  type DestinoDescarte,
  type TipoEventoCiclo,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  desvincularCursoModelo,
  lerCatalogoCursos,
  lerCursosDoModelo,
  lerEventosCiclo,
  lerObsolescencia,
  lerOperadores,
  registrarEventoCiclo,
  URL_PGTS,
  vincularCursoModelo,
} from '../api-manutencao.js';
import { comTodos, dataBr, problemasDe, reais, reaisDigitados } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{
  equipamento: { id: number; fabricante: string | null; modelo: string | null; situacao: string };
  apoio: ApoioManutencao;
}>();
const emit = defineEmits<{ gravado: [string] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const aberta = ref(false);
const id = computed(() => props.equipamento.id);
const fabricante = computed(() => (props.equipamento.fabricante ?? '').trim());
const modelo = computed(() => (props.equipamento.modelo ?? '').trim());
const temModelo = computed(() => fabricante.value.length >= 2 && modelo.value.length >= 1);
const podeEditar = computed(() => props.apoio.pode.editar && props.apoio.gravacao.ligada);
const descartado = computed(() => (eventos.data.value ?? []).some((e) => e.tipo === 'descarte'));

const cursos = useQuery({
  queryKey: computed(() => ['manutencao', 'ciclo', 'cursos', fabricante.value, modelo.value]),
  queryFn: () => lerCursosDoModelo(fabricante.value, modelo.value),
  enabled: computed(() => aberta.value && temModelo.value),
});
const catalogo = useQuery({
  queryKey: ['manutencao', 'ciclo', 'catalogo'],
  queryFn: lerCatalogoCursos,
  enabled: computed(() => aberta.value && temModelo.value && props.apoio.pode.editar),
});
const operadores = useQuery({
  queryKey: computed(() => ['manutencao', 'ciclo', 'operadores', id.value]),
  queryFn: () => lerOperadores(id.value),
  enabled: aberta,
});
const indice = useQuery({
  queryKey: computed(() => ['manutencao', 'ciclo', 'indice', id.value]),
  queryFn: () => lerObsolescencia(id.value),
  enabled: aberta,
});
const eventos = useQuery({
  queryKey: computed(() => ['manutencao', 'ciclo', 'eventos', id.value]),
  queryFn: () => lerEventosCiclo(id.value),
  enabled: aberta,
});

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);
const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
async function tentar(f: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  gravando.value = true;
  try {
    const r = await f();
    mensagem.value = r.mensagem;
    emit('gravado', r.mensagem);
    await cliente.invalidateQueries({ queryKey: ['manutencao'] });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Cursos exigidos do modelo ───────────────────────────────────────────────────────────────────────────────────────
const tituloDoCurso = (c: number) =>
  (cursos.data.value ?? []).find((x) => x.curso === c)?.cursoTitulo ??
  (catalogo.data.value ?? []).find((x) => x.id === c)?.titulo ??
  String(c);
const opcoesCatalogo = computed(() => {
  const ja = new Set((cursos.data.value ?? []).map((c) => c.curso));
  return comTodos(
    t('manutencao.nenhumSelecionado'),
    (catalogo.data.value ?? [])
      .filter((c) => c.ativo && !ja.has(c.id))
      .map((c) => ({
        valor: c.id,
        rotulo: `${c.codigo} - ${c.titulo} (${validade(c.validadeMeses)})`,
      })),
  );
});
const validade = (m: number) =>
  m > 0 ? t('manutencao.ciclo.cursos.meses', { n: m }) : t('manutencao.ciclo.cursos.naoVence');
const cursoEscolhido = ref<number | null>(null);
async function exigir() {
  const corpo = { fabricante: fabricante.value, modelo: modelo.value, curso: cursoEscolhido.value };
  problemas.value = problemasDe(esquemaVincularCursoModelo, corpo);
  if (listaProblemas.value.length > 0) return;
  if (await tentar(() => vincularCursoModelo(corpo))) cursoEscolhido.value = null;
}
const removendo = ref<number | null>(null);
const motivoRemocao = ref('');
function abrirRemocao(v: number) {
  removendo.value = removendo.value === v ? null : v;
  motivoRemocao.value = '';
  problemas.value = {};
}
async function remover() {
  const v = removendo.value;
  if (v === null) return;
  const m = motivoRemocao.value.trim();
  if (m.length < 10) {
    problemas.value = { motivo: t('manutencao.motivoAjuda') };
    return;
  }
  problemas.value = {};
  if (await tentar(() => desvincularCursoModelo(v, m))) removendo.value = null;
}

// ── Índice de obsolescência ─────────────────────────────────────────────────────────────────────────────────────────
const linhasIndice = computed(() => {
  const i = indice.data.value;
  if (!i) return null;
  return {
    valor: t('manutencao.ciclo.indice.valor', { indice: i.indice, faixa: FAIXAS_OBSOLESCENCIA[i.faixa] }),
    idade:
      i.idade.idadeMeses === null
        ? t('manutencao.ciclo.indice.idadeSemBase', { peso: i.idade.peso })
        : t('manutencao.ciclo.indice.idade', {
            pontos: i.idade.pontos,
            peso: i.idade.peso,
            idade: i.idade.idadeMeses,
            vida: i.idade.vidaUtilMeses,
          }),
    custo:
      i.custo.valorCent === null
        ? t('manutencao.ciclo.indice.custoSemBase', {
            peso: i.custo.peso,
            custo: reais(i.custo.custoCent / 100),
          })
        : t('manutencao.ciclo.indice.custo', {
            pontos: i.custo.pontos,
            peso: i.custo.peso,
            custo: reais(i.custo.custoCent / 100),
            valor: reais(i.custo.valorCent / 100),
            janela: i.janelaMeses,
          }),
    falhas: t('manutencao.ciclo.indice.falhas', {
      pontos: i.falhas.pontos,
      peso: i.falhas.peso,
      corretivas: i.falhas.corretivas,
      janela: i.janelaMeses,
      teto: i.falhas.teto,
    }),
    conta: t('manutencao.ciclo.indice.conta', {
      idade: i.idade.pontos,
      custo: i.custo.pontos,
      falhas: i.falhas.pontos,
      indice: i.indice,
    }),
  };
});

// ── Eventos do ciclo de vida ────────────────────────────────────────────────────────────────────────────────────────
const opcoesTipo = CODIGOS_TIPO_EVENTO_CICLO.map((c) => ({ valor: c, rotulo: TIPOS_EVENTO_CICLO[c] }));
const opcoesDestino = comTodos(
  t('manutencao.nenhumSelecionado'),
  CODIGOS_DESTINO_DESCARTE.map((c) => ({ valor: c, rotulo: DESTINOS_DESCARTE[c] })),
);
const registrando = ref(false);
const rascunho = ref({
  tipo: 'incorporacao' as TipoEventoCiclo,
  data: props.apoio.hoje,
  motivo: '',
  documento: '',
  destino: null as DestinoDescarte | null,
  valorObtido: '',
  autorizadoPor: '',
});
function abrirRegistro() {
  const feitos = new Set((eventos.data.value ?? []).map((e) => e.tipo));
  rascunho.value = {
    tipo: CODIGOS_TIPO_EVENTO_CICLO.find((c) => !feitos.has(c)) ?? 'incorporacao',
    data: props.apoio.hoje,
    motivo: '',
    documento: '',
    destino: null,
    valorObtido: '',
    autorizadoPor: '',
  };
  problemas.value = {};
  erro.value = null;
  registrando.value = true;
}
async function gravarEvento() {
  const r = rascunho.value;
  const descarte = r.tipo === 'descarte';
  const valor = descarte && r.valorObtido.trim() ? reaisDigitados(r.valorObtido) : null;
  if (descarte && r.valorObtido.trim() && valor === null) {
    problemas.value = { valorObtidoCent: t('manutencao.valorInvalido') };
    return;
  }
  const corpo = {
    tipo: r.tipo,
    data: r.data,
    motivo: r.motivo.trim(),
    documento: r.documento.trim() || null,
    destino: descarte ? r.destino : null,
    valorObtidoCent: valor === null ? null : Math.round(valor * 100),
    autorizadoPor: r.autorizadoPor.trim(),
  };
  problemas.value = problemasDe(esquemaRegistrarEventoCiclo, { ...corpo, equipamento: id.value });
  if (listaProblemas.value.length > 0) return;
  if (await tentar(() => registrarEventoCiclo(id.value, corpo))) registrando.value = false;
}
</script>

<template>
  <section aria-labelledby="equipamento-ciclo-titulo" data-testid="equipamento-ciclo">
    <h3 id="equipamento-ciclo-titulo">{{ t('manutencao.ciclo.abrir') }}</h3>
    <p class="secundario">{{ t('manutencao.ciclo.ajuda') }}</p>
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="aberta ? t('manutencao.ciclo.fecharSecao') : t('manutencao.ciclo.abrir')"
        data-testid="ciclo-alternar"
        @acionar="aberta = !aberta"
      />
      <a :href="URL_PGTS" download data-testid="ciclo-pgts" :title="t('manutencao.ciclo.pgtsAjuda')">{{
        t('manutencao.ciclo.pgts')
      }}</a>
    </div>

    <template v-if="aberta">
      <p v-if="mensagem" role="status" data-testid="ciclo-mensagem">{{ mensagem }}</p>
      <ErroManutencao v-if="erro" :erro="erro" grupo="ciclo" />
      <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="ciclo-problemas">
        <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
      </ul>

      <!-- Cursos exigidos -->
      <div class="bloco" data-testid="ciclo-cursos">
        <h4>{{ t('manutencao.ciclo.cursos.titulo') }}</h4>
        <p v-if="!temModelo" data-testid="ciclo-sem-modelo">{{ t('manutencao.ciclo.cursos.semModelo') }}</p>
        <template v-else>
          <p class="secundario">{{ fabricante }} / {{ modelo }}</p>
          <ErroManutencao v-if="cursos.isError.value" :erro="cursos.error.value" />
          <p v-else-if="!cursos.data.value" role="status">{{ t('manutencao.carregando') }}</p>
          <p v-else-if="cursos.data.value.length === 0">{{ t('manutencao.ciclo.cursos.vazio') }}</p>
          <ul v-else class="historico">
            <li v-for="c in cursos.data.value" :key="c.id" :data-testid="`ciclo-curso-${c.id}`">
              {{ c.cursoCodigo }} - {{ c.cursoTitulo }} ({{ t('manutencao.ciclo.cursos.validade') }}:
              {{ validade(c.validadeMeses) }})
              <span v-if="!c.cursoAtivo" class="vencido">({{ t('manutencao.ciclo.cursos.inativo') }})</span>
              <span class="secundario">
                -
                {{
                  t('manutencao.ciclo.cursos.exigido', {
                    por: c.criadoPor,
                    em: dataBr(c.criadoEm.slice(0, 10)),
                  })
                }}
              </span>
              <SanteBotao
                v-if="podeEditar"
                variante="texto"
                :rotulo="t('manutencao.ciclo.cursos.remover')"
                :data-testid="`ciclo-curso-remover-${c.id}`"
                @acionar="abrirRemocao(c.id)"
              />
              <form
                v-if="removendo === c.id"
                class="bloco"
                :data-testid="`ciclo-curso-form-remover-${c.id}`"
                @submit.prevent="remover"
              >
                <SanteCampoTexto
                  v-model="motivoRemocao"
                  multilinha
                  obrigatorio
                  :rotulo="t('manutencao.motivo')"
                  :max-bytes="500"
                  data-testid="ciclo-curso-motivo"
                />
                <p class="secundario">{{ t('manutencao.motivoAjuda') }}</p>
                <div class="acoes">
                  <SanteBotao
                    tipo="submit"
                    :rotulo="t('manutencao.ciclo.cursos.gravarRemocao')"
                    :desabilitado="gravando"
                    data-testid="ciclo-curso-confirmar-remocao"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('manutencao.cancelar')"
                    @acionar="removendo = null"
                  />
                </div>
              </form>
            </li>
          </ul>
          <form v-if="podeEditar" class="acoes" data-testid="ciclo-curso-form" @submit.prevent="exigir">
            <SanteSelecao
              v-model="cursoEscolhido"
              :rotulo="t('manutencao.ciclo.cursos.curso')"
              :opcoes="opcoesCatalogo"
              busca
              data-testid="ciclo-curso-escolha"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="t('manutencao.ciclo.cursos.exigir')"
              :desabilitado="gravando || cursoEscolhido === null"
              data-testid="ciclo-curso-exigir"
            />
          </form>
        </template>
      </div>

      <!-- Operadores -->
      <div class="bloco" data-testid="ciclo-operadores">
        <h4>{{ t('manutencao.ciclo.operadores.titulo') }}</h4>
        <ErroManutencao v-if="operadores.isError.value" :erro="operadores.error.value" />
        <p v-else-if="!operadores.data.value" role="status">{{ t('manutencao.carregando') }}</p>
        <p v-else-if="operadores.data.value.cursos.length === 0">
          {{ t('manutencao.ciclo.operadores.semCursos') }}
        </p>
        <template v-else>
          <h5>{{ t('manutencao.ciclo.operadores.aptos', { n: operadores.data.value.aptos.length }) }}</h5>
          <p v-if="operadores.data.value.aptos.length === 0">
            {{ t('manutencao.ciclo.operadores.nenhumApto') }}
          </p>
          <div v-else class="rolagem">
            <table class="tabela" data-testid="ciclo-aptos">
              <thead>
                <tr>
                  <th scope="col">{{ t('manutencao.ciclo.operadores.nome') }}</th>
                  <th scope="col">{{ t('manutencao.ciclo.operadores.matricula') }}</th>
                  <th scope="col">{{ t('manutencao.ciclo.operadores.validoAte') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="o in operadores.data.value.aptos"
                  :key="o.vinculo"
                  :data-testid="`ciclo-apto-${o.vinculo}`"
                >
                  <td>{{ o.nome }}</td>
                  <td>{{ o.matricula ?? '' }}</td>
                  <td>{{ o.validoAte ? dataBr(o.validoAte) : t('manutencao.ciclo.cursos.naoVence') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-if="operadores.data.value.pendentes.length > 0">
            <h5>
              {{ t('manutencao.ciclo.operadores.pendentes', { n: operadores.data.value.pendentes.length }) }}
            </h5>
            <div class="rolagem">
              <table class="tabela" data-testid="ciclo-pendentes">
                <thead>
                  <tr>
                    <th scope="col">{{ t('manutencao.ciclo.operadores.nome') }}</th>
                    <th scope="col">{{ t('manutencao.ciclo.operadores.faltam') }}</th>
                    <th scope="col">{{ t('manutencao.ciclo.operadores.vencidos') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="o in operadores.data.value.pendentes"
                    :key="o.vinculo"
                    :data-testid="`ciclo-pendente-${o.vinculo}`"
                  >
                    <td>
                      {{ o.nome }}<template v-if="o.matricula"> ({{ o.matricula }})</template>
                    </td>
                    <td>{{ o.faltam.map(tituloDoCurso).join(', ') }}</td>
                    <td>{{ o.vencidos.map(tituloDoCurso).join(', ') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
      </div>

      <!-- Índice de obsolescência -->
      <div class="bloco" data-testid="ciclo-indice">
        <h4>{{ t('manutencao.ciclo.indice.titulo') }}</h4>
        <ErroManutencao v-if="indice.isError.value" :erro="indice.error.value" />
        <p v-else-if="!linhasIndice" role="status">{{ t('manutencao.carregando') }}</p>
        <template v-else>
          <p>
            <strong data-testid="ciclo-indice-valor">{{ linhasIndice.valor }}</strong>
          </p>
          <ul class="historico">
            <li data-testid="ciclo-indice-idade">{{ linhasIndice.idade }}</li>
            <li data-testid="ciclo-indice-custo">{{ linhasIndice.custo }}</li>
            <li data-testid="ciclo-indice-falhas">{{ linhasIndice.falhas }}</li>
          </ul>
          <p class="secundario" data-testid="ciclo-indice-conta">{{ linhasIndice.conta }}</p>
        </template>
      </div>

      <!-- Eventos do ciclo de vida -->
      <div class="bloco" data-testid="ciclo-eventos">
        <h4>{{ t('manutencao.ciclo.eventos.titulo') }}</h4>
        <ErroManutencao v-if="eventos.isError.value" :erro="eventos.error.value" />
        <p v-else-if="!eventos.data.value" role="status">{{ t('manutencao.carregando') }}</p>
        <p v-else-if="eventos.data.value.length === 0">{{ t('manutencao.ciclo.eventos.vazio') }}</p>
        <ul v-else class="historico">
          <li v-for="x in eventos.data.value" :key="x.id" :data-testid="`ciclo-evento-${x.id}`">
            <strong>{{ TIPOS_EVENTO_CICLO[x.tipo] }}</strong> {{ dataBr(x.data) }}: {{ x.motivo }}
            <template v-if="x.documento">
              - {{ t('manutencao.ciclo.eventos.documento') }} {{ x.documento }}</template
            >
            <template v-if="x.destino"> - {{ DESTINOS_DESCARTE[x.destino] }}</template>
            <template v-if="x.valorContabilCent !== null">
              - {{ t('manutencao.ciclo.eventos.valorContabil') }}
              {{ reais(x.valorContabilCent / 100) }}</template
            >
            <template v-if="x.valorObtidoCent !== null">
              - {{ t('manutencao.ciclo.eventos.valorObtido') }} {{ reais(x.valorObtidoCent / 100) }}</template
            >
            - {{ t('manutencao.ciclo.eventos.autorizadoPor') }} {{ x.autorizadoPor }} ({{
              t('manutencao.ciclo.eventos.por', { por: x.por })
            }})
          </li>
        </ul>
        <SanteBotao
          v-if="podeEditar && !registrando"
          variante="secundario"
          :rotulo="t('manutencao.ciclo.eventos.registrar')"
          :desabilitado="descartado || !eventos.data.value"
          data-testid="ciclo-evento-novo"
          @acionar="abrirRegistro"
        />
        <form v-if="registrando" class="bloco" data-testid="ciclo-evento-form" @submit.prevent="gravarEvento">
          <div class="campos">
            <SanteSelecao
              v-model="rascunho.tipo"
              :rotulo="t('manutencao.ciclo.eventos.tipo')"
              :opcoes="opcoesTipo"
              data-testid="ciclo-evento-tipo"
            />
            <SanteData
              v-model="rascunho.data"
              editavel
              :rotulo="t('manutencao.ciclo.eventos.data')"
              :maximo="apoio.hoje"
              data-testid="ciclo-evento-data"
            />
            <SanteCampoTexto
              v-model="rascunho.autorizadoPor"
              obrigatorio
              :rotulo="t('manutencao.ciclo.eventos.autorizadoPor')"
              :max-bytes="70"
              data-testid="ciclo-evento-autorizado"
            />
            <SanteCampoTexto
              v-model="rascunho.documento"
              :obrigatorio="rascunho.tipo === 'descarte'"
              :rotulo="t('manutencao.ciclo.eventos.documento')"
              :max-bytes="60"
              data-testid="ciclo-evento-documento"
            />
            <template v-if="rascunho.tipo === 'descarte'">
              <SanteSelecao
                v-model="rascunho.destino"
                :rotulo="t('manutencao.ciclo.eventos.destino')"
                :opcoes="opcoesDestino"
                data-testid="ciclo-evento-destino"
              />
              <SanteCampoTexto
                v-model="rascunho.valorObtido"
                :rotulo="t('manutencao.ciclo.eventos.valorObtido')"
                :max-bytes="16"
                data-testid="ciclo-evento-valor"
              />
            </template>
          </div>
          <SanteAlerta
            v-if="rascunho.tipo !== 'incorporacao'"
            variante="aviso"
            :texto="
              rascunho.tipo === 'descarte'
                ? t('manutencao.ciclo.eventos.descarteAviso')
                : t('manutencao.ciclo.eventos.desativacaoAviso')
            "
          />
          <SanteCampoTexto
            v-model="rascunho.motivo"
            multilinha
            obrigatorio
            :rotulo="t('manutencao.ciclo.eventos.motivo')"
            :max-bytes="500"
            data-testid="ciclo-evento-motivo"
          />
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="t('manutencao.gravar')"
              :desabilitado="gravando"
              data-testid="ciclo-evento-gravar"
            />
            <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="registrando = false" />
          </div>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
