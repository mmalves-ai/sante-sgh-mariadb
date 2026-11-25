<script setup lang="ts">
// Central de regras de aviso clínico (F3.3, linha 03-PEP L133). Numa tela só: os eventos clínicos (tipos de aviso),
// as regras (evento, setor e especialidade do evento, destinatários por setor, especialidade, categoria profissional,
// perfil ou pessoa, e o canal: central de avisos e, se quiser, e-mail), a emissão de um evento para conferir quem
// recebe e os avisos emitidos recentemente (central, e-mail e cientes). A validação é na hora, pela mesma regra do
// domínio que a API aplica (validarRegraAvisoClinico e validarTipoAvisoClinico): o botão fica travado com o motivo.
// Quem causou o evento não é avisado. A alteração da regra gera uma versão nova (histórico preservado no banco).
// Ler exige pep.admin.ler; gravar e emitir, pep.admin.editar.
import {
  CATEGORIAS_TIPO_AVISO_CLINICO,
  MENSAGEM_REGRA_AVISO_CLINICO,
  PRIORIDADES_TIPO_AVISO_CLINICO,
  validarRegraAvisoClinico,
  validarTipoAvisoClinico,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AlvoAviso,
  type AvisoEmitido,
  type CanalAviso,
  emitirAviso,
  type EventoAviso,
  gravarRegraAviso,
  gravarTipoAviso,
  lerPainelRegrasAviso,
  type RegraAviso,
  type TipoAviso,
} from '../api-avisos-clinicos-regras.js';

const { t } = useI18n();
const k = (c: string) => t(`pep.avisosRegras.${c}`);
const ALVOS: AlvoAviso[] = ['setor', 'especialidade', 'categoria_profissional', 'perfil', 'usuario'];
const CANAIS: CanalAviso[] = ['sistema', 'email'];

const tipos = ref<TipoAviso[]>([]);
const regras = ref<RegraAviso[]>([]);
const recentes = ref<AvisoEmitido[]>([]);
const opcoes = ref<Record<AlvoAviso, { id: number; nome: string }[]>>({
  setor: [],
  especialidade: [],
  categoria_profissional: [],
  perfil: [],
  usuario: [],
});
const erro = ref<string | null>(null);
const salvo = ref<string | null>(null);
const hoje = () => new Date().toISOString().slice(0, 10);

function tipoVazio(): TipoAviso {
  return {
    codigo: '',
    descricao: '',
    categoria: 'outro',
    prioridade: 'media',
    enviaEmail: false,
    exigeCiencia: false,
    ativo: true,
  };
}
function regraVazia(): RegraAviso {
  return {
    codigo: '',
    nome: '',
    tipoAviso: null,
    setorEvento: null,
    especialidadeEvento: null,
    mensagem: '',
    canais: ['sistema'],
    alvos: [],
    vigenciaInicio: hoje(),
    vigenciaFim: null,
    ativo: true,
    motivo: null,
  };
}
const novoTipo = ref<TipoAviso>(tipoVazio());
const regra = ref<RegraAviso>(regraVazia());
const alvoTipo = ref<AlvoAviso>('setor');
const alvoId = ref<number | null>(null);
const evento = ref<EventoAviso>({
  tipoAviso: '',
  setor: null,
  especialidade: null,
  paciente: null,
  titulo: null,
  mensagem: null,
});
const resultado = ref<string | null>(null);

const problemaTipo = computed(() => {
  const r = validarTipoAvisoClinico(novoTipo.value);
  return r ? MENSAGEM_REGRA_AVISO_CLINICO[r] : null;
});
const problemaRegra = computed(() => {
  const r = validarRegraAvisoClinico(regra.value);
  return r ? MENSAGEM_REGRA_AVISO_CLINICO[r] : null;
});

const opcoesEvento = computed(() => [
  { valor: null, rotulo: k('escolhaEvento'), desabilitada: true },
  ...tipos.value.filter((x) => x.ativo).map((x) => ({ valor: x.codigo, rotulo: x.descricao })),
]);
const opcoesEventoEmitir = computed(() => [
  { valor: '', rotulo: k('escolhaEvento'), desabilitada: true },
  ...tipos.value.filter((x) => x.ativo).map((x) => ({ valor: x.codigo, rotulo: x.descricao })),
]);
const opcoesDe = (a: AlvoAviso) => [
  { valor: null, rotulo: k('qualquer') },
  ...opcoes.value[a].map((o) => ({ valor: o.id, rotulo: o.nome })),
];
const opcoesCategoria = computed(() =>
  CATEGORIAS_TIPO_AVISO_CLINICO.map((c) => ({ valor: c, rotulo: t(`pep.avisosRegras.categorias.${c}`) })),
);
const opcoesPrioridade = computed(() =>
  PRIORIDADES_TIPO_AVISO_CLINICO.map((p) => ({ valor: p, rotulo: t(`pep.avisosRegras.prioridades.${p}`) })),
);
const opcoesTipoAlvo = computed(() =>
  ALVOS.map((a) => ({ valor: a, rotulo: t(`pep.avisosRegras.alvos.${a}`) })),
);
const opcoesAlvo = computed(() => [
  { valor: null, rotulo: k('alvo'), desabilitada: true },
  ...opcoes.value[alvoTipo.value]
    .filter((o) => !regra.value.alvos.some((a) => a.tipo === alvoTipo.value && a.id === o.id))
    .map((o) => ({ valor: o.id, rotulo: o.nome })),
]);
function nomeDoAlvo(a: { tipo: AlvoAviso; id: number }): string {
  return opcoes.value[a.tipo].find((o) => o.id === a.id)?.nome ?? `#${a.id}`;
}
const nomeDoEvento = (c: string | null) => tipos.value.find((x) => x.codigo === c)?.descricao ?? c ?? '';

async function carregar(): Promise<void> {
  try {
    const p = await lerPainelRegrasAviso();
    tipos.value = p.tipos;
    regras.value = p.regras;
    recentes.value = p.recentes;
    opcoes.value = p.opcoes;
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
  }
}
async function acao(f: () => Promise<unknown>): Promise<boolean> {
  try {
    erro.value = null;
    salvo.value = null;
    await f();
    return true;
  } catch (x) {
    erro.value = x instanceof Error ? x.message : String(x);
    return false;
  } finally {
    await carregar();
  }
}
async function incluirTipo(): Promise<void> {
  if (problemaTipo.value) return;
  if (await acao(() => gravarTipoAviso(novoTipo.value))) {
    novoTipo.value = tipoVazio();
    salvo.value = k('gravado');
  }
}
function alternarCanal(c: CanalAviso, ligado: boolean): void {
  const s = new Set(regra.value.canais);
  if (ligado) s.add(c);
  else s.delete(c);
  regra.value.canais = CANAIS.filter((x) => s.has(x));
}
function incluirAlvo(): void {
  if (alvoId.value === null) return;
  regra.value.alvos = [...regra.value.alvos, { tipo: alvoTipo.value, id: alvoId.value }];
  alvoId.value = null;
}
function removerAlvo(i: number): void {
  regra.value.alvos = regra.value.alvos.filter((_, j) => j !== i);
}
function editar(r: RegraAviso): void {
  regra.value = { ...r, canais: [...r.canais], alvos: r.alvos.map((a) => ({ ...a })), motivo: null };
}
async function gravarRegra(): Promise<void> {
  if (problemaRegra.value) return;
  const r = regra.value;
  const corpo: RegraAviso = { ...r, codigo: r.codigo || codigoDe(r.nome) };
  if (await acao(() => gravarRegraAviso(corpo))) {
    regra.value = regraVazia();
    salvo.value = k('gravado');
  }
}
/** Código da regra nova, tirado do nome (minúsculas, sem acento, sublinhado). */
function codigoDe(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'regra';
}
async function emitir(): Promise<void> {
  if (!evento.value.tipoAviso) return;
  resultado.value = null;
  await acao(async () => {
    const r = await emitirAviso(evento.value);
    resultado.value =
      r.avisos.length === 0
        ? k('nenhumEmitido')
        : t('pep.avisosRegras.emitidos', { avisos: r.avisos.length, destinatarios: r.destinatarios });
  });
}
const data = (s: string) => new Date(s).toLocaleString('pt-BR');
onMounted(carregar);
</script>

<template>
  <section class="avisos" data-testid="avisos-regras">
    <h1>{{ k('titulo') }}</h1>
    <p class="dica">{{ k('explica') }}</p>
    <SanteAlerta v-if="erro" :texto="erro" data-testid="avr-erro" />
    <p v-if="salvo" role="status" data-testid="avr-salvo">{{ salvo }}</p>

    <h2>{{ k('tipos') }}</h2>
    <table data-testid="avr-tipos">
      <thead>
        <tr>
          <th scope="col">{{ k('codigo') }}</th>
          <th scope="col">{{ k('descricao') }}</th>
          <th scope="col">{{ k('categoria') }}</th>
          <th scope="col">{{ k('prioridade') }}</th>
          <th scope="col">{{ k('enviaEmail') }}</th>
          <th scope="col">{{ k('exigeCiencia') }}</th>
          <th scope="col">
            <span class="sr">{{ k('incluirTipo') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in tipos" :key="x.codigo" :data-testid="`avr-tipo-${x.codigo}`">
          <td>{{ x.codigo }}</td>
          <td>{{ x.descricao }}</td>
          <td>{{ t(`pep.avisosRegras.categorias.${x.categoria}`) }}</td>
          <td>{{ t(`pep.avisosRegras.prioridades.${x.prioridade}`) }}</td>
          <td>{{ x.enviaEmail ? k('sim') : '' }}</td>
          <td>{{ x.exigeCiencia ? k('sim') : '' }}</td>
          <td></td>
        </tr>
        <tr data-testid="avr-tipo-novo">
          <td>
            <input
              v-model.trim="novoTipo.codigo"
              size="14"
              :aria-label="k('codigo')"
              data-testid="avr-tipo-codigo"
            />
          </td>
          <td>
            <input
              v-model="novoTipo.descricao"
              :aria-label="k('descricao')"
              data-testid="avr-tipo-descricao"
            />
          </td>
          <td>
            <SanteSelecao
              v-model="novoTipo.categoria"
              ocultar-rotulo
              :rotulo="k('categoria')"
              :opcoes="opcoesCategoria"
              data-testid="avr-tipo-categoria"
            />
          </td>
          <td>
            <SanteSelecao
              v-model="novoTipo.prioridade"
              ocultar-rotulo
              :rotulo="k('prioridade')"
              :opcoes="opcoesPrioridade"
              data-testid="avr-tipo-prioridade"
            />
          </td>
          <td><input v-model="novoTipo.enviaEmail" type="checkbox" :aria-label="k('enviaEmail')" /></td>
          <td><input v-model="novoTipo.exigeCiencia" type="checkbox" :aria-label="k('exigeCiencia')" /></td>
          <td>
            <button
              type="button"
              :disabled="!!problemaTipo"
              data-testid="avr-tipo-incluir"
              @click="incluirTipo"
            >
              {{ k('incluirTipo') }}
            </button>
            <small v-if="problemaTipo && (novoTipo.codigo || novoTipo.descricao)" role="status">{{
              problemaTipo
            }}</small>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>{{ k('regras') }}</h2>
    <p v-if="regras.length === 0" class="dica" data-testid="avr-sem-regras">{{ k('semRegras') }}</p>
    <table v-else data-testid="avr-regras">
      <thead>
        <tr>
          <th scope="col">{{ k('nome') }}</th>
          <th scope="col">{{ k('evento') }}</th>
          <th scope="col">{{ k('canais') }}</th>
          <th scope="col">{{ k('destinatarios') }}</th>
          <th scope="col">
            <span class="sr">{{ k('editar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras" :key="r.id" :data-testid="`avr-regra-${r.id}`">
          <td>
            {{ r.nome }}
            <small v-if="r.numeroVersao">{{ t('pep.avisosRegras.versaoN', { n: r.numeroVersao }) }}</small>
          </td>
          <td>{{ nomeDoEvento(r.tipoAviso) }}</td>
          <td>{{ r.canais.map((c) => t(`pep.avisosRegras.canal.${c}`)).join(', ') }}</td>
          <td>{{ r.alvos.map(nomeDoAlvo).join(', ') }}</td>
          <td>
            <button type="button" :data-testid="`avr-editar-${r.id}`" @click="editar(r)">
              {{ k('editar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <fieldset class="form" data-testid="avr-form">
      <legend>{{ regra.id ? `${k('editar')}: ${regra.nome}` : k('novaRegra') }}</legend>
      <label>
        {{ k('nome') }}
        <input v-model="regra.nome" data-testid="avr-nome" />
      </label>
      <SanteSelecao
        v-model="regra.tipoAviso"
        :rotulo="k('evento')"
        :opcoes="opcoesEvento"
        data-testid="avr-evento"
      />
      <SanteSelecao
        v-model="regra.setorEvento"
        :rotulo="k('setorEvento')"
        :opcoes="opcoesDe('setor')"
        data-testid="avr-setor-evento"
      />
      <SanteSelecao
        v-model="regra.especialidadeEvento"
        :rotulo="k('especialidadeEvento')"
        :opcoes="opcoesDe('especialidade')"
        data-testid="avr-especialidade-evento"
      />
      <label class="largo">
        {{ k('mensagem') }}
        <textarea v-model="regra.mensagem" rows="2" data-testid="avr-mensagem"></textarea>
      </label>
      <fieldset>
        <legend>{{ k('canais') }}</legend>
        <label v-for="c in CANAIS" :key="c">
          <input
            type="checkbox"
            :checked="regra.canais.includes(c)"
            :data-testid="`avr-canal-${c}`"
            @change="alternarCanal(c, ($event.target as HTMLInputElement).checked)"
          />
          {{ t(`pep.avisosRegras.canal.${c}`) }}
        </label>
      </fieldset>
      <fieldset class="largo">
        <legend>{{ k('destinatarios') }}</legend>
        <ul data-testid="avr-alvos">
          <li v-for="(a, i) in regra.alvos" :key="`${a.tipo}:${a.id}`">
            {{ t(`pep.avisosRegras.alvos.${a.tipo}`) }}: {{ nomeDoAlvo(a) }}
            <button
              type="button"
              :aria-label="t('pep.avisosRegras.remover', { nome: nomeDoAlvo(a) })"
              :data-testid="`avr-remover-${a.tipo}-${a.id}`"
              @click="removerAlvo(i)"
            >
              {{ k('removerCurto') }}
            </button>
          </li>
        </ul>
        <div class="linha">
          <SanteSelecao
            v-model="alvoTipo"
            :rotulo="k('tipoAlvo')"
            :opcoes="opcoesTipoAlvo"
            data-testid="avr-alvo-tipo"
            @update:model-value="alvoId = null"
          />
          <SanteSelecao v-model="alvoId" :rotulo="k('alvo')" :opcoes="opcoesAlvo" data-testid="avr-alvo" />
          <button
            type="button"
            :disabled="alvoId === null"
            data-testid="avr-alvo-incluir"
            @click="incluirAlvo"
          >
            {{ k('incluirAlvo') }}
          </button>
        </div>
      </fieldset>
      <label>
        {{ k('vigenciaInicio') }}
        <input v-model="regra.vigenciaInicio" type="date" data-testid="avr-vigencia-inicio" />
      </label>
      <label>
        {{ k('vigenciaFim') }}
        <input
          :value="regra.vigenciaFim ?? ''"
          type="date"
          data-testid="avr-vigencia-fim"
          @input="regra.vigenciaFim = ($event.target as HTMLInputElement).value || null"
        />
      </label>
      <label v-if="regra.id" class="largo">
        {{ k('motivo') }}
        <input
          :value="regra.motivo ?? ''"
          data-testid="avr-motivo"
          @input="regra.motivo = ($event.target as HTMLInputElement).value || null"
        />
      </label>
      <div class="largo">
        <button type="button" :disabled="!!problemaRegra" data-testid="avr-gravar" @click="gravarRegra">
          {{ k('gravar') }}
        </button>
        <button v-if="regra.id" type="button" data-testid="avr-nova" @click="regra = regraVazia()">
          {{ k('novaRegra') }}
        </button>
        <small v-if="problemaRegra" role="status" data-testid="avr-problema">{{ problemaRegra }}</small>
      </div>
    </fieldset>

    <h2>{{ k('emitirTitulo') }}</h2>
    <p data-testid="avr-emitir-dica">{{ k('emitirDica') }}</p>
    <div class="linha" data-testid="avr-emitir-form">
      <SanteSelecao
        v-model="evento.tipoAviso"
        :rotulo="k('evento')"
        :opcoes="opcoesEventoEmitir"
        data-testid="avr-emitir-evento"
      />
      <SanteSelecao
        v-model="evento.setor"
        :rotulo="k('setor')"
        :opcoes="opcoesDe('setor')"
        data-testid="avr-emitir-setor"
      />
      <SanteSelecao
        v-model="evento.especialidade"
        :rotulo="k('especialidade')"
        :opcoes="opcoesDe('especialidade')"
        data-testid="avr-emitir-especialidade"
      />
      <button type="button" :disabled="!evento.tipoAviso" data-testid="avr-emitir" @click="emitir">
        {{ k('emitir') }}
      </button>
    </div>
    <p v-if="resultado" role="status" data-testid="avr-resultado">{{ resultado }}</p>

    <h2>{{ k('recentes') }}</h2>
    <table data-testid="avr-recentes">
      <thead>
        <tr>
          <th scope="col">{{ k('evento') }}</th>
          <th scope="col">{{ k('prioridade') }}</th>
          <th scope="col">{{ t('pep.avisosRegras.canal.sistema') }}</th>
          <th scope="col">{{ t('pep.avisosRegras.canal.email') }}</th>
          <th scope="col">{{ k('cientes') }}</th>
          <th scope="col">{{ k('geradoEm') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in recentes" :key="a.id" :data-testid="`avr-recente-${a.id}`">
          <td>{{ a.titulo }}</td>
          <td>{{ t(`pep.avisosRegras.prioridades.${a.prioridade}`) }}</td>
          <td>{{ a.sistema }}</td>
          <td>{{ a.email }}</td>
          <td>{{ a.cientes }}</td>
          <td>{{ data(a.geradoEm) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.avisos table {
  width: 100%;
  border-collapse: collapse;
}
.avisos th,
.avisos td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
.form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 0.5rem 1rem;
}
.form label {
  display: flex;
  flex-direction: column;
}
.largo {
  grid-column: 1 / -1;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
