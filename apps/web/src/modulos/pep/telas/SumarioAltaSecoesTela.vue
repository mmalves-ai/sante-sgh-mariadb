<script setup lang="ts">
// Seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124). Uma grade por tipo de atendimento, editável na
// linha, com a prévia ao lado de como o médico verá o sumário (as seções que valem, na ordem, com as obrigatórias
// marcadas). Validação na hora, a mesma regra do domínio na API. Tirar uma seção de uso é desmarcar "Em uso": nada é
// apagado. Embaixo, os períodos de consulta próprios do cliente (horas antes da alta).
// Ler exige pep.admin.ler; gravar, pep.admin.editar.
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type Componente,
  gravarPeriodo,
  gravarSecao,
  lerPeriodos,
  lerSecoes,
  PERIODOS,
  type PeriodoConsulta,
  type SecaoVigente,
  TIPOS_ATENDIMENTO,
  TIPOS_COM_PERIODO,
  TIPOS_CONTEUDO,
  type TipoAtendimentoSecao,
} from '../api-sumario-secoes.js';

const { t } = useI18n();
const k = (c: string) => t(`pep.sumarioSecoes.${c}`);
const opcoesTipo = computed(() => TIPOS_ATENDIMENTO.map((x) => ({ valor: x, rotulo: k(`tipos.${x}`) })));
const opcoesConteudo = computed(() => TIPOS_CONTEUDO.map((x) => ({ valor: x, rotulo: k(`conteudos.${x}`) })));
const opcoesPeriodo = computed(() => [
  { valor: '', rotulo: k('semPeriodo') },
  ...PERIODOS.map((x) => ({ valor: `f:${x}`, rotulo: k(`periodosFixos.${x}`) })),
  ...periodos.value
    .filter((x) => x.ativo && x.id !== null)
    .map((p) => ({ valor: `p:${p.id}`, rotulo: p.descricao })),
]);
const opcoesAbrangencia = computed(() => [
  { valor: 0, rotulo: k('doEstabelecimento') },
  { valor: null, rotulo: k('doCliente') },
]);
const tipo = ref<TipoAtendimentoSecao>('internacao');
const itens = ref<Componente[]>([]);
const vigentes = ref<SecaoVigente[]>([]);
const periodos = ref<PeriodoConsulta[]>([]);
const erro = ref<string | null>(null);
const salvo = ref<string | null>(null);
const nova = ref<Componente>(vazia());
const novoPeriodo = ref<PeriodoConsulta>(periodoVazio());

function vazia(): Componente {
  return {
    id: null,
    estabelecimento: 0,
    codigo: '',
    descricao: '',
    tipoConteudo: 'texto_livre',
    tipoAtendimento: tipo.value,
    ordem: (itens.value.length + 1) * 10,
    obrigatorio: false,
    periodo: null,
    periodoConsulta: null,
    ativo: true,
    versao: null,
  };
}
/** O recorte da seção numa só lista: fixo ("f:") ou período próprio do cliente ("p:"). */
function valorPeriodo(c: Componente): string {
  if (c.periodoConsulta !== null) return `p:${c.periodoConsulta}`;
  return c.periodo !== null ? `f:${c.periodo}` : '';
}
function escolherPeriodo(c: Componente, v: string): void {
  c.periodoConsulta = v.startsWith('p:') ? Number(v.slice(2)) : null;
  c.periodo = v.startsWith('f:') ? (v.slice(2) as Componente['periodo']) : null;
}
function periodoVazio(): PeriodoConsulta {
  return {
    id: null,
    codigo: '',
    descricao: '',
    atendimentoInteiro: false,
    horasRetroativas: 12,
    ordem: 0,
    ativo: true,
    versao: null,
  };
}
const CODIGO = /^[a-z0-9][a-z0-9_-]{0,29}$/;
function problema(c: Componente): string | null {
  if (!CODIGO.test(c.codigo)) return k('erroCodigo');
  if (!c.descricao.trim()) return k('erroDescricao');
  if (c.periodo !== null && !TIPOS_COM_PERIODO.has(c.tipoConteudo)) return k('erroPeriodo');
  return null;
}
function problemaPeriodo(p: PeriodoConsulta): string | null {
  if (!CODIGO.test(p.codigo)) return k('erroCodigo');
  if (!p.descricao.trim()) return k('erroDescricao');
  const h = p.horasRetroativas;
  if (!p.atendimentoInteiro && (h === null || !Number.isInteger(h) || h < 1 || h > 720))
    return k('erroHoras');
  return null;
}
function conteudo(c: Componente): void {
  if (!TIPOS_COM_PERIODO.has(c.tipoConteudo)) c.periodo = null;
}

async function carregar(): Promise<void> {
  try {
    const [s, p] = await Promise.all([lerSecoes(tipo.value), lerPeriodos()]);
    itens.value = s.itens.filter((x) => x.tipoAtendimento === tipo.value || x.tipoAtendimento === 'todos');
    vigentes.value = s.vigentes;
    periodos.value = p.itens;
    nova.value = vazia();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function salvar(c: Componente): Promise<void> {
  if (problema(c)) return;
  try {
    erro.value = null;
    await gravarSecao(c);
    salvo.value = k('gravada');
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function salvarPeriodo(p: PeriodoConsulta): Promise<void> {
  if (problemaPeriodo(p)) return;
  try {
    erro.value = null;
    await gravarPeriodo(p);
    salvo.value = k('periodoGravado');
    novoPeriodo.value = periodoVazio();
    await carregar();
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
const horas = (v: string): number | null => (v.trim() === '' ? null : Number(v));
watch(tipo, carregar);
onMounted(carregar);
</script>

<template>
  <section class="sec" data-testid="sumario-secoes">
    <h1>{{ k('titulo') }}</h1>
    <p class="dica">{{ k('explica') }}</p>
    <SanteAlerta v-if="erro" :texto="erro" data-testid="sec-erro" />
    <p v-if="salvo" role="status" data-testid="sec-salvo">{{ salvo }}</p>
    <SanteSelecao v-model="tipo" :rotulo="k('tipo')" :opcoes="opcoesTipo" data-testid="sec-tipo" />
    <div class="lado">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ k('ordem') }}</th>
            <th scope="col">{{ k('codigo') }}</th>
            <th scope="col">{{ k('descricao') }}</th>
            <th scope="col">{{ k('conteudo') }}</th>
            <th scope="col">{{ k('periodo') }}</th>
            <th scope="col">{{ k('obrigatoria') }}</th>
            <th scope="col">{{ k('abrangencia') }}</th>
            <th scope="col">{{ k('ativa') }}</th>
            <th scope="col">
              <span class="sr">{{ k('gravar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in [...itens, nova]"
            :key="c.id ?? 'nova'"
            :data-testid="c.id ? `sec-linha-${c.codigo}` : 'sec-nova'"
          >
            <td>
              <input v-model.number="c.ordem" inputmode="numeric" size="4" :aria-label="k('ordem')" />
            </td>
            <td>
              <span v-if="c.id">{{ c.codigo }}</span>
              <input
                v-else
                v-model.trim="c.codigo"
                size="12"
                :aria-label="k('codigo')"
                data-testid="sec-codigo"
              />
            </td>
            <td>
              <input
                v-model="c.descricao"
                maxlength="150"
                :aria-label="k('descricao')"
                data-testid="sec-descricao"
              />
            </td>
            <td>
              <SanteSelecao
                :model-value="c.tipoConteudo"
                ocultar-rotulo
                :rotulo="k('conteudo')"
                :opcoes="opcoesConteudo"
                data-testid="sec-conteudo"
                @update:model-value="
                  (v) => {
                    c.tipoConteudo = v;
                    conteudo(c);
                  }
                "
              />
            </td>
            <td>
              <SanteSelecao
                :model-value="valorPeriodo(c)"
                :desabilitado="!TIPOS_COM_PERIODO.has(c.tipoConteudo)"
                ocultar-rotulo
                :rotulo="k('periodo')"
                :opcoes="opcoesPeriodo"
                data-testid="sec-periodo"
                @update:model-value="(v) => escolherPeriodo(c, v)"
              />
            </td>
            <td>
              <input
                v-model="c.obrigatorio"
                type="checkbox"
                :aria-label="k('obrigatoria')"
                data-testid="sec-obrigatoria"
              />
            </td>
            <td>
              <span v-if="c.id">{{
                c.estabelecimento === null ? k('doCliente') : k('doEstabelecimento')
              }}</span>
              <SanteSelecao
                v-else
                v-model="c.estabelecimento"
                ocultar-rotulo
                :rotulo="k('abrangencia')"
                :opcoes="opcoesAbrangencia"
                data-testid="sec-abrangencia"
              />
            </td>
            <td>
              <input v-model="c.ativo" type="checkbox" :aria-label="k('ativa')" data-testid="sec-ativa" />
            </td>
            <td>
              <button type="button" :disabled="!!problema(c)" data-testid="sec-gravar" @click="salvar(c)">
                {{ c.id ? k('gravar') : k('incluir') }}
              </button>
              <small v-if="problema(c) && (c.id || c.codigo || c.descricao)" role="status">{{
                problema(c)
              }}</small>
            </td>
          </tr>
        </tbody>
      </table>
      <aside data-testid="sec-previa">
        <h2>{{ k('vigentes') }}</h2>
        <ol>
          <li v-for="v in vigentes" :key="v.codigo">
            {{ v.descricao }}
            <strong v-if="v.obrigatorio">*</strong>
            <small>({{ k(`origem.${v.origem}`) }})</small>
          </li>
        </ol>
      </aside>
    </div>

    <h2>{{ k('periodos') }}</h2>
    <table data-testid="sec-periodos">
      <thead>
        <tr>
          <th scope="col">{{ k('codigo') }}</th>
          <th scope="col">{{ k('descricao') }}</th>
          <th scope="col">{{ k('inteiro') }}</th>
          <th scope="col">{{ k('horas') }}</th>
          <th scope="col">{{ k('ativa') }}</th>
          <th scope="col">
            <span class="sr">{{ k('gravar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in [...periodos, novoPeriodo]" :key="p.id ?? 'novo'">
          <td>
            <span v-if="p.id">{{ p.codigo }}</span>
            <input v-else v-model.trim="p.codigo" size="12" :aria-label="k('codigo')" />
          </td>
          <td><input v-model="p.descricao" maxlength="150" :aria-label="k('descricao')" /></td>
          <td><input v-model="p.atendimentoInteiro" type="checkbox" :aria-label="k('inteiro')" /></td>
          <td>
            <input
              :value="p.horasRetroativas ?? ''"
              :disabled="p.atendimentoInteiro"
              inputmode="numeric"
              size="4"
              :aria-label="k('horas')"
              @input="p.horasRetroativas = horas(($event.target as HTMLInputElement).value)"
            />
          </td>
          <td><input v-model="p.ativo" type="checkbox" :aria-label="k('ativa')" /></td>
          <td>
            <button type="button" :disabled="!!problemaPeriodo(p)" @click="salvarPeriodo(p)">
              {{ p.id ? k('gravar') : k('incluir') }}
            </button>
            <small v-if="problemaPeriodo(p) && (p.id || p.codigo)" role="status">{{
              problemaPeriodo(p)
            }}</small>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.sec table {
  border-collapse: collapse;
}
.sec th,
.sec td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
.lado {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
