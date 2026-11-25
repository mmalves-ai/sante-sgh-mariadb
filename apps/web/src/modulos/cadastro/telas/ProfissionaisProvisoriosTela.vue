<script setup lang="ts">
// Profissional provisório (F8, 02-CAD linha 21): `/cadastros/profissionais/provisorios`. Uma tela só: a lista com o
// alerta do prazo (vencidos e os que vencem em até 3 dias no topo; nunca trava), o cadastro mínimo com a inscrição no
// conselho (conselho, número e UF, como pede o conselho profissional) e o prazo sugerido de 15 dias, e, ao abrir um
// provisório, os registros ligados, os candidatos a cadastro definitivo (mesma inscrição ou mesmo CPF: um clique para
// regularizar e transferir os registros), a prorrogação e o cancelamento com motivo. Validação na hora pelos mesmos
// códigos do servidor (regra em @sgh/dominio-cadastro, profissional/provisorio), que confere de novo.
import { cpfValido, somenteDigitos } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  cancelarProvisorio,
  criarProvisorio,
  type DetalheProvisorio,
  type FiltroProvisorios,
  type ItemProvisorio,
  lerDetalheProvisorio,
  lerProvisorios,
  ligarRegistro,
  prorrogarProvisorio,
  regularizarProvisorio,
  type TipoUso,
} from '../api-provisorio.js';

const { t } = useI18n();
const fila = useQueryClient();
const podeCriar = computed(() => pode('cadastro.profissional.criar'));
const podeEditar = computed(() => pode('cadastro.profissional.editar'));
const filtro = ref<FiltroProvisorios>('abertos');
const visao = useQuery({
  queryKey: computed(() => ['cadastro', 'provisorios', filtro.value]),
  queryFn: () => lerProvisorios(filtro.value),
});
const erro = ref<unknown>(null);
const aviso = ref('');
const tentou = ref(false);

const TIPOS: TipoUso[] = ['atendimento', 'paciente', 'agendamento_cirurgico', 'agendamento_internacao'];

const f = reactive({
  nome: '',
  cpf: '',
  conselhoId: null as number | null,
  numeroConselho: '',
  ufConselhoId: null as number | null,
  motivo: '',
  telefone: '',
  dataInicio: '',
  prazo: '',
});

const hoje = computed(() => visao.data.value?.hoje ?? '');
const conselhoEscolhido = computed(() => visao.data.value?.conselhos.find((c) => c.id === f.conselhoId));

function dias(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** Os mesmos códigos da regra do domínio, para a tela avisar antes de gravar. */
const problemas = computed<string[]>(() => {
  const e: string[] = [];
  const nome = f.nome.trim();
  if (nome.length < 3) e.push('nome-curto');
  else if (nome.length > 150) e.push('nome-longo');
  else if (!/\s/.test(nome)) e.push('nome-incompleto');
  if (f.cpf.trim() && !cpfValido(somenteDigitos(f.cpf))) e.push('cpf-invalido');
  if (f.conselhoId === null) e.push('conselho-ausente');
  if (!f.numeroConselho.replace(/[^0-9A-Za-z]/g, '')) e.push('numero-conselho-ausente');
  if (f.ufConselhoId === null && (conselhoEscolhido.value?.porUf ?? true)) e.push('uf-conselho-ausente');
  if (f.motivo.trim().length < 10) e.push('motivo-curto');
  const inicio = f.dataInicio || hoje.value;
  if (!inicio) e.push('inicio-invalido');
  else if (hoje.value && inicio > hoje.value) e.push('inicio-futuro');
  else if (hoje.value && dias(inicio, hoje.value) > 30) e.push('inicio-antigo');
  if (f.prazo) {
    if (f.prazo < inicio) e.push('prazo-antes-do-inicio');
    else if (dias(inicio, f.prazo) > 90) e.push('prazo-longo');
  }
  return e;
});

function limpar(): void {
  Object.assign(f, {
    nome: '',
    cpf: '',
    conselhoId: null,
    numeroConselho: '',
    ufConselhoId: null,
    motivo: '',
    telefone: '',
    dataInicio: '',
    prazo: '',
  });
  tentou.value = false;
}

async function rodar(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    if (ok) aviso.value = ok;
    await fila.invalidateQueries({ queryKey: ['cadastro', 'provisorios'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

async function gravar(): Promise<void> {
  tentou.value = true;
  if (problemas.value.length) return;
  const ok = await rodar(
    () =>
      criarProvisorio({
        nome: f.nome,
        cpf: f.cpf.trim() || null,
        conselhoId: f.conselhoId,
        numeroConselho: f.numeroConselho,
        ufConselhoId: f.ufConselhoId,
        motivo: f.motivo,
        dataInicio: f.dataInicio || hoje.value,
        prazo: f.prazo || null,
        telefone: f.telefone.trim() || null,
      }),
    t('profissionalProvisorio.gravado'),
  );
  if (ok) limpar();
}

// O provisório aberto: registros, candidatos e as ações.
const aberto = ref<ItemProvisorio | null>(null);
const detalhe = ref<DetalheProvisorio | null>(null);
const uso = reactive({ tipo: 'atendimento' as TipoUso, registroId: '' });
const definitivo = ref<number | null>(null);
const prazoNovo = ref('');
const motivoPrazo = ref('');
const motivoCancelar = ref('');

async function abrir(x: ItemProvisorio): Promise<void> {
  aberto.value = x;
  detalhe.value = null;
  definitivo.value = null;
  prazoNovo.value = '';
  motivoPrazo.value = '';
  motivoCancelar.value = '';
  erro.value = null;
  try {
    detalhe.value = await lerDetalheProvisorio(x.id);
    definitivo.value = detalhe.value.candidatos[0]?.id ?? null;
  } catch (e) {
    erro.value = e;
  }
}
async function recarregarAberto(): Promise<void> {
  if (!aberto.value) return;
  await visao.refetch();
  const novo = visao.data.value?.itens.find((i) => i.id === aberto.value!.id);
  if (novo) await abrir(novo);
  else aberto.value = null;
}

async function ligar(): Promise<void> {
  const x = aberto.value;
  const n = Number(uso.registroId);
  if (!x || !Number.isInteger(n) || n <= 0) return;
  if (await rodar(() => ligarRegistro(x.id, uso.tipo, n), t('profissionalProvisorio.ligado'))) {
    uso.registroId = '';
    await recarregarAberto();
  }
}
async function regularizar(): Promise<void> {
  const x = aberto.value;
  if (!x || definitivo.value === null) return;
  let transferidos = 0;
  const ok = await rodar(async () => {
    transferidos = (await regularizarProvisorio(x.id, x.versao, definitivo.value!)).transferidos;
  }, '');
  if (ok) {
    aviso.value = t('profissionalProvisorio.regularizado', { transferidos });
    await recarregarAberto();
  }
}
async function prorrogar(): Promise<void> {
  const x = aberto.value;
  if (!x || !prazoNovo.value) return;
  if (
    await rodar(
      () => prorrogarProvisorio(x.id, x.versao, prazoNovo.value, motivoPrazo.value),
      t('profissionalProvisorio.prorrogado'),
    )
  )
    await recarregarAberto();
}
async function cancelar(): Promise<void> {
  const x = aberto.value;
  if (!x) return;
  if (
    await rodar(
      () => cancelarProvisorio(x.id, x.versao, motivoCancelar.value),
      t('profissionalProvisorio.cancelado'),
    )
  )
    await recarregarAberto();
}

const ehAberto = (x: ItemProvisorio) => x.situacao === 'provisorio' || x.situacao === 'expirado';
const estadoTexto = (x: ItemProvisorio) =>
  t(`profissionalProvisorio.estado.${x.estadoPrazo}`, { dias: Math.abs(x.diasParaPrazo) });
</script>

<template>
  <section class="tela" data-testid="tela-provisorios" aria-labelledby="prov-titulo">
    <h1 id="prov-titulo">{{ t('profissionalProvisorio.titulo') }}</h1>
    <p>{{ t('profissionalProvisorio.texto') }}</p>
    <MensagemErro v-if="visao.isError.value" :erro="visao.error.value" />
    <p v-else-if="!visao.data.value">{{ t('profissionalProvisorio.carregando') }}</p>
    <template v-else>
      <div class="barra">
        <SanteSelecao
          v-model="filtro"
          :rotulo="t('profissionalProvisorio.filtro')"
          :opcoes="[
            { valor: 'abertos', rotulo: t('profissionalProvisorio.filtroAbertos') },
            { valor: 'vencidos', rotulo: t('profissionalProvisorio.filtroVencidos') },
            { valor: 'todos', rotulo: t('profissionalProvisorio.filtroTodos') },
          ]"
          data-testid="prov-filtro"
        />
        <p data-testid="prov-resumo" role="status">
          {{ t('profissionalProvisorio.resumo', visao.data.value.resumo) }}
        </p>
      </div>
      <p v-if="aviso" class="aviso" role="status" data-testid="prov-aviso">{{ aviso }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="grade">
        <div>
          <p v-if="!visao.data.value.itens.length">{{ t('profissionalProvisorio.nenhum') }}</p>
          <ul class="lista" data-testid="prov-lista">
            <li v-for="x in visao.data.value.itens" :key="x.id" :data-testid="`prov-item-${x.id}`">
              <strong>{{ x.nome }}</strong>
              <span>
                · {{ x.conselhoSigla }} {{ x.numeroConselho
                }}<template v-if="x.ufSigla">/{{ x.ufSigla }}</template> ·
                {{ t(`profissionalProvisorio.situacao.${x.situacao}`) }}
              </span>
              <span :class="['selo', `selo--${x.estadoPrazo}`]" :data-testid="`prov-estado-${x.id}`">{{
                estadoTexto(x)
              }}</span>
              <span
                >·
                {{
                  t('profissionalProvisorio.registros', { usos: x.usos, pendentes: x.usosPendentes })
                }}</span
              >
              <button type="button" class="acoes" :data-testid="`prov-abrir-${x.id}`" @click="abrir(x)">
                {{ t('profissionalProvisorio.abrir') }}
              </button>
            </li>
          </ul>

          <section v-if="aberto" class="detalhe" data-testid="prov-detalhe" aria-labelledby="prov-det-titulo">
            <h2 id="prov-det-titulo">{{ aberto.nome }}</h2>
            <p>{{ aberto.motivo }}</p>
            <h3>{{ t('profissionalProvisorio.ligar') }}</h3>
            <p v-if="detalhe && !detalhe.usos.length">{{ t('profissionalProvisorio.semRegistro') }}</p>
            <ul v-if="detalhe" data-testid="prov-usos">
              <li v-for="u in detalhe.usos" :key="u.id">
                {{ u.sequencia }}. {{ t(`profissionalProvisorio.tipos.${u.tipo}`) }} {{ u.registroId }} ·
                {{
                  u.regularizado
                    ? t('profissionalProvisorio.transferido')
                    : t('profissionalProvisorio.pendente')
                }}
              </li>
            </ul>
            <div v-if="ehAberto(aberto) && podeCriar" class="linha">
              <SanteSelecao
                v-model="uso.tipo"
                :rotulo="t('profissionalProvisorio.tipoRegistro')"
                :opcoes="TIPOS.map((v) => ({ valor: v, rotulo: t(`profissionalProvisorio.tipos.${v}`) }))"
                data-testid="prov-uso-tipo"
              />
              <label
                >{{ t('profissionalProvisorio.registroId') }}
                <input v-model="uso.registroId" inputmode="numeric" data-testid="prov-uso-registro"
              /></label>
              <button type="button" data-testid="prov-uso-ligar" :disabled="!uso.registroId" @click="ligar">
                {{ t('profissionalProvisorio.ligar') }}
              </button>
            </div>

            <template v-if="ehAberto(aberto) && podeEditar && detalhe">
              <h3>{{ t('profissionalProvisorio.regularizar') }}</h3>
              <p v-if="!detalhe.candidatos.length">{{ t('profissionalProvisorio.semCandidato') }}</p>
              <div v-else class="linha">
                <SanteSelecao
                  v-model="definitivo"
                  :rotulo="t('profissionalProvisorio.definitivo')"
                  :opcoes="
                    detalhe.candidatos.map((k) => ({
                      valor: k.id,
                      rotulo: `${k.nome} (${k.por === 'cpf' ? t('profissionalProvisorio.porCpf') : t('profissionalProvisorio.porInscricao')})`,
                    }))
                  "
                  data-testid="prov-definitivo"
                />
                <button type="button" data-testid="prov-regularizar" @click="regularizar">
                  {{ t('profissionalProvisorio.regularizar') }}
                </button>
              </div>
            </template>

            <template v-if="ehAberto(aberto) && podeCriar">
              <h3>{{ t('profissionalProvisorio.prorrogar') }}</h3>
              <div class="linha">
                <label
                  >{{ t('profissionalProvisorio.novoPrazo') }}
                  <input v-model="prazoNovo" type="date" :min="aberto.prazo" data-testid="prov-prazo-novo"
                /></label>
                <label
                  >{{ t('profissionalProvisorio.motivoPrazo') }}
                  <input v-model="motivoPrazo" maxlength="500" data-testid="prov-prazo-motivo"
                /></label>
                <button
                  type="button"
                  data-testid="prov-prorrogar"
                  :disabled="!prazoNovo || motivoPrazo.trim().length < 10"
                  @click="prorrogar"
                >
                  {{ t('profissionalProvisorio.prorrogar') }}
                </button>
              </div>
            </template>

            <template v-if="ehAberto(aberto) && podeEditar && aberto.usosPendentes === 0">
              <h3>{{ t('profissionalProvisorio.cancelar') }}</h3>
              <div class="linha">
                <label
                  >{{ t('profissionalProvisorio.motivoCancelar') }}
                  <input v-model="motivoCancelar" maxlength="500" data-testid="prov-cancelar-motivo"
                /></label>
                <button
                  type="button"
                  data-testid="prov-cancelar"
                  :disabled="motivoCancelar.trim().length < 10"
                  @click="cancelar"
                >
                  {{ t('profissionalProvisorio.cancelar') }}
                </button>
              </div>
            </template>
            <button type="button" @click="aberto = null">{{ t('profissionalProvisorio.fechar') }}</button>
          </section>
        </div>

        <form v-if="podeCriar" class="ficha" data-testid="prov-ficha" @submit.prevent="gravar">
          <h2>{{ t('profissionalProvisorio.novo') }}</h2>
          <label
            >{{ t('profissionalProvisorio.nome') }}
            <input v-model="f.nome" maxlength="150" data-testid="prov-nome"
          /></label>
          <label
            >{{ t('profissionalProvisorio.cpf') }}
            <input v-model="f.cpf" maxlength="14" inputmode="numeric" data-testid="prov-cpf"
          /></label>
          <SanteSelecao
            v-model="f.conselhoId"
            :rotulo="t('profissionalProvisorio.conselho')"
            :opcoes="visao.data.value.conselhos.map((c) => ({ valor: c.id, rotulo: c.sigla }))"
            data-testid="prov-conselho"
          />
          <label
            >{{ t('profissionalProvisorio.numeroConselho') }}
            <input v-model="f.numeroConselho" maxlength="20" data-testid="prov-numero"
          /></label>
          <SanteSelecao
            v-model="f.ufConselhoId"
            :rotulo="t('profissionalProvisorio.ufConselho')"
            :opcoes="visao.data.value.ufs.map((u) => ({ valor: u.id, rotulo: u.sigla }))"
            data-testid="prov-uf"
          />
          <label
            >{{ t('profissionalProvisorio.motivo') }}
            <textarea v-model="f.motivo" maxlength="500" rows="2" data-testid="prov-motivo"></textarea>
          </label>
          <label
            >{{ t('profissionalProvisorio.telefone') }}
            <input v-model="f.telefone" maxlength="20" data-testid="prov-telefone"
          /></label>
          <div class="linha">
            <label
              >{{ t('profissionalProvisorio.dataInicio') }}
              <input
                v-model="f.dataInicio"
                type="date"
                :max="hoje"
                :placeholder="hoje"
                data-testid="prov-inicio"
            /></label>
            <label
              >{{ t('profissionalProvisorio.prazo') }}
              <input
                v-model="f.prazo"
                type="date"
                :placeholder="visao.data.value.prazoSugerido"
                data-testid="prov-prazo"
            /></label>
          </div>
          <div v-if="tentou && problemas.length" class="problemas" role="alert" data-testid="prov-problemas">
            {{ t('profissionalProvisorio.problemas') }}
            <ul>
              <li v-for="p in problemas" :key="p">{{ t(`profissionalProvisorio.erros.${p}`) }}</li>
            </ul>
          </div>
          <button type="submit" data-testid="prov-gravar">{{ t('profissionalProvisorio.gravar') }}</button>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.barra,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.grade {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
  gap: var(--sgh-espaco-3);
}
.lista {
  list-style: none;
  padding: 0;
}
.lista li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.acoes {
  float: right;
}
.selo {
  margin-left: var(--sgh-espaco-1);
  font-weight: 600;
}
.selo--vencido {
  color: var(--sgh-alerta);
}
.detalhe {
  margin-top: var(--sgh-espaco-3);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.ficha label {
  display: block;
  margin-bottom: var(--sgh-espaco-1);
}
.problemas {
  color: var(--sgh-alerta);
}
</style>
