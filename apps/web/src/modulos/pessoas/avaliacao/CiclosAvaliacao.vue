<script setup lang="ts">
// Aba "Ciclos" da avaliação de desempenho (W0-06, parte 5d): a lista dos ciclos (tipo, período, prazo, escala e a
// contagem das avaliações em vigor) e a ficha do ciclo (alteração do aberto com motivo e o valor anterior no histórico;
// encerrar, cancelar e reabrir com motivo; excluir o ciclo sem avaliação, com o cancelamento oferecido no 409; as
// avaliações do ciclo, inclusive as versões substituídas pela correção, cada uma abrindo a sua ficha; e, no ciclo aberto,
// abrir a avaliação de um colaborador).
import {
  type ApoioAvaliacao,
  type CicloAvaliacaoResposta,
  esquemaIncluirCiclo,
  TIPOS_CICLO_AVALIACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import AbrirAvaliacao from './AbrirAvaliacao.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import {
  alterarCiclo,
  excluirCiclo,
  incluirCiclo,
  lerCiclos,
  lerFichaCiclo,
  situacaoCiclo,
} from './api-avaliacao.js';
import { mudancasDaCorrecao, notaMaxDe, passagensDoCiclo } from './avaliacao-comum.js';

type Situacao = CicloAvaliacaoResposta['situacao'];
type Tipo = (typeof TIPOS_CICLO_AVALIACAO)[number];

const props = defineProps<{ apoio: ApoioAvaliacao }>();
const emit = defineEmits<{ gravado: [r: unknown]; abrir: [id: number] }>();
const { t, te } = useI18n();
const pode = computed(() => props.apoio.acoes.gerir);
const lista = useQuery({ queryKey: ['pessoas', 'avaliacao', 'ciclos'], queryFn: lerCiclos });
const ciclos = computed(() => lista.data.value ?? []);

const selecionado = ref<number | 'novo' | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['pessoas', 'avaliacao', 'ciclo', selecionado.value]),
  queryFn: () => lerFichaCiclo(selecionado.value as number),
  enabled: computed(() => typeof selecionado.value === 'number'),
});
const f = computed(() => (typeof selecionado.value === 'number' ? (ficha.data.value ?? null) : null));
const c = computed(() => f.value?.ciclo ?? null);

const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
interface Form {
  nome: string;
  tipo: Tipo;
  inicio: string | null;
  fim: string | null;
  prazo: string | null;
  notaMax: string;
}
const vazio = (): Form => ({
  nome: '',
  tipo: 'periodico',
  inicio: null,
  fim: null,
  prazo: null,
  notaMax: '5',
});
const form = ref<Form>(vazio());
function preencher(x: CicloAvaliacaoResposta): void {
  form.value = {
    nome: x.nome,
    tipo: x.tipo,
    inicio: x.inicio,
    fim: x.fim,
    prazo: x.prazo,
    notaMax: String(x.notaMax),
  };
}
watch(c, (x) => {
  if (x) preencher(x);
});
function abrir(id: number | 'novo'): void {
  erro.value = null;
  aviso.value = null;
  selecionado.value = id;
  if (id === 'novo') form.value = vazio();
  else if (c.value?.id === id) preencher(c.value);
}
const opcoesTipo = computed(() =>
  TIPOS_CICLO_AVALIACAO.map((x) => ({ valor: x, rotulo: t(`pessoas.avaliacao.ciclos.tipos.${x}`) })),
);
const dados = () => ({
  nome: form.value.nome,
  tipo: form.value.tipo,
  inicio: form.value.inicio ?? '',
  fim: form.value.fim ?? '',
  prazo: form.value.prazo ?? '',
  notaMax: notaMaxDe(form.value.notaMax) ?? 0,
});
function validar(): boolean {
  if (notaMaxDe(form.value.notaMax) === null) {
    aviso.value = t('pessoas.avaliacao.ciclos.notaMaxInvalida');
    return false;
  }
  const r = esquemaIncluirCiclo.safeParse(dados());
  aviso.value = r.success ? null : (r.error.issues[0]?.message ?? null);
  return r.success;
}
const dialogoAlterar = ref(false);
async function gravar(): Promise<void> {
  erro.value = null;
  if (!validar()) return;
  if (selecionado.value !== 'novo') {
    dialogoAlterar.value = true;
    return;
  }
  ocupado.value = true;
  try {
    const r = await incluirCiclo(esquemaIncluirCiclo.parse(dados()));
    emit('gravado', r);
    selecionado.value = r.id;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const alterar = (motivo: string) =>
  alterarCiclo({
    ...esquemaIncluirCiclo.parse(dados()),
    ciclo: c.value!.id,
    versao: c.value!.versao,
    motivo,
  });

// ── Situação e exclusão ──
const destino = ref<Situacao>('encerrado');
const dialogoSituacao = ref(false);
function pedirSituacao(s: Situacao): void {
  destino.value = s;
  dialogoSituacao.value = true;
}
const mudarSituacao = (motivo: string) =>
  situacaoCiclo({ ciclo: c.value!.id, versao: c.value!.versao, situacao: destino.value, motivo });
const dialogoExclusao = ref(false);
const excluir = (motivo: string) => excluirCiclo({ ciclo: c.value!.id, versao: c.value!.versao, motivo });
function aposExcluir(r: unknown): void {
  selecionado.value = null;
  emit('gravado', r);
}
function cancelarEmVez(): void {
  dialogoExclusao.value = false;
  pedirSituacao('cancelado');
}

// ── Abrir a avaliação no ciclo ──
const dialogoAbrir = ref(false);
function aposAbrirAvaliacao(r: unknown): void {
  emit('gravado', r);
  const id = (r as { id?: unknown } | null)?.id;
  if (typeof id === 'number') emit('abrir', id);
}

// ── Histórico ──
const txt = (v: unknown, campo: string): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'tipo' && typeof v === 'string' && te(`pessoas.avaliacao.ciclos.tipos.${v}`))
    return t(`pessoas.avaliacao.ciclos.tipos.${v}`);
  const x = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(x) ? dataBr(x) : x;
};
const nomeOperacao = (op: string): string => {
  const chave = `pessoas.avaliacao.historico.operacoes.${op.replace('.', '_')}`;
  return te(chave) ? t(chave) : op;
};
const quando = (em: string) => `${dataBr(em.slice(0, 10))} ${em.slice(11, 16)}`;
const editavel = computed(
  () => pode.value && (selecionado.value === 'novo' || c.value?.situacao === 'aberto'),
);
</script>

<template>
  <section class="bloco" data-testid="aval-ciclos">
    <ErroPessoas v-if="erro" :erro="erro" />
    <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.data.value && ciclos.length === 0" data-testid="ciclos-vazio">
      {{ t('pessoas.avaliacao.ciclos.vazio') }}
    </p>
    <table v-else-if="ciclos.length > 0" class="tabela" data-testid="tabela-ciclos">
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.nome') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.tipo') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.periodo') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.prazo') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.escala') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.avaliacoes') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.situacao') }}</th>
          <th scope="col">{{ t('pessoas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in ciclos" :key="x.id" :data-testid="`ciclo-${x.id}`">
          <th scope="row">{{ x.nome }}</th>
          <td>{{ t(`pessoas.avaliacao.ciclos.tipos.${x.tipo}`) }}</td>
          <td>
            {{ t('pessoas.avaliacao.ciclos.periodoTexto', { inicio: dataBr(x.inicio), fim: dataBr(x.fim) }) }}
          </td>
          <td>{{ dataBr(x.prazo) }}</td>
          <td>{{ t('pessoas.avaliacao.ciclos.escalaTexto', { max: x.notaMax }) }}</td>
          <td>{{ x.avaliacoes.rascunho }} / {{ x.avaliacoes.finalizada }} / {{ x.avaliacoes.ciente }}</td>
          <td>{{ t(`pessoas.avaliacao.ciclos.situacoes.${x.situacao}`) }}</td>
          <td>
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.abrir', { nome: x.nome })"
              variante="texto"
              :data-testid="`abrir-ciclo-${x.id}`"
              @acionar="abrir(x.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="pode" class="acoes">
      <SanteBotao
        :rotulo="t('pessoas.avaliacao.ciclos.novo')"
        variante="secundario"
        data-testid="novo-ciclo"
        @acionar="abrir('novo')"
      />
    </div>

    <section
      v-if="selecionado !== null"
      class="bloco"
      aria-labelledby="pes-aval-ciclo"
      data-testid="ficha-ciclo"
    >
      <h2 id="pes-aval-ciclo">
        {{ selecionado === 'novo' ? t('pessoas.avaliacao.ciclos.tituloNovo') : (c?.nome ?? '') }}
      </h2>
      <ErroPessoas v-if="ficha.isError.value" :erro="ficha.error.value" />
      <p v-else-if="selecionado !== 'novo' && !c" role="status">{{ t('pessoas.carregando') }}</p>
      <template v-else>
        <p v-if="c && c.situacao !== 'aberto'" class="secundario" data-testid="ciclo-fechado">
          {{
            t('pessoas.avaliacao.ciclos.fechadoAviso', {
              situacao: t(`pessoas.avaliacao.ciclos.situacoes.${c.situacao}`),
              motivo: c.motivoSituacao ?? '',
            })
          }}
        </p>
        <p v-else-if="c" class="secundario" data-testid="ciclo-alterado">
          {{ t('pessoas.avaliacao.alteradoPor', { por: c.alteradoPor, em: quando(c.alteradoEm) }) }}
        </p>
        <form class="bloco" data-testid="form-ciclo" @submit.prevent="gravar">
          <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
          <div class="campos">
            <SanteCampoTexto
              v-model="form.nome"
              :rotulo="t('pessoas.avaliacao.ciclos.nome')"
              :max-bytes="80"
              obrigatorio
              data-testid="ciclo-nome"
            />
            <SanteSelecao
              v-model="form.tipo"
              :rotulo="t('pessoas.avaliacao.ciclos.tipo')"
              :opcoes="opcoesTipo"
              :desabilitado="!editavel"
              data-testid="ciclo-tipo"
            />
          </div>
          <div class="campos">
            <SanteData
              v-model="form.inicio"
              :rotulo="t('pessoas.avaliacao.ciclos.inicio')"
              :editavel="editavel"
              data-testid="ciclo-inicio"
            />
            <SanteData
              v-model="form.fim"
              :rotulo="t('pessoas.avaliacao.ciclos.fim')"
              :editavel="editavel"
              data-testid="ciclo-fim"
            />
            <SanteData
              v-model="form.prazo"
              :rotulo="t('pessoas.avaliacao.ciclos.prazo')"
              :editavel="editavel"
              data-testid="ciclo-prazo"
            />
            <SanteCampoTexto
              v-model="form.notaMax"
              :rotulo="t('pessoas.avaliacao.ciclos.notaMax')"
              :max-bytes="2"
              obrigatorio
              data-testid="ciclo-nota-max"
            />
          </div>
          <div v-if="pode" class="acoes">
            <SanteBotao
              v-if="editavel"
              :rotulo="
                selecionado === 'novo'
                  ? t('pessoas.avaliacao.ciclos.incluir')
                  : t('pessoas.avaliacao.ciclos.alterar')
              "
              tipo="submit"
              :desabilitado="ocupado"
              data-testid="gravar-ciclo"
            />
            <template v-if="c">
              <SanteBotao
                v-for="s in passagensDoCiclo(c.situacao)"
                :key="s"
                :rotulo="t(`pessoas.avaliacao.ciclos.passar.${s}`)"
                variante="secundario"
                :data-testid="`ciclo-passar-${s}`"
                @acionar="pedirSituacao(s)"
              />
              <SanteBotao
                :rotulo="t('pessoas.avaliacao.excluir')"
                variante="texto"
                data-testid="excluir-ciclo"
                @acionar="dialogoExclusao = true"
              />
            </template>
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.fechar')"
              variante="texto"
              @acionar="selecionado = null"
            />
          </div>
        </form>

        <section v-if="f" class="bloco" data-testid="ciclo-avaliacoes">
          <h3>{{ t('pessoas.avaliacao.ciclos.avaliacoesDoCiclo') }}</h3>
          <div v-if="pode && c?.situacao === 'aberto'" class="acoes">
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.abrirAval.titulo')"
              variante="secundario"
              data-testid="abrir-avaliacao"
              @acionar="dialogoAbrir = true"
            />
          </div>
          <p v-if="f.avaliacoes.length === 0" class="secundario">
            {{ t('pessoas.avaliacao.ciclos.semAvaliacao') }}
          </p>
          <table v-else class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('pessoas.avaliacao.ciclos.colaborador') }}</th>
                <th scope="col">{{ t('pessoas.avaliacao.ciclos.numero') }}</th>
                <th scope="col">{{ t('pessoas.avaliacao.ciclos.avaliador') }}</th>
                <th scope="col">{{ t('pessoas.avaliacao.ciclos.situacao') }}</th>
                <th scope="col">{{ t('pessoas.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in f.avaliacoes" :key="v.id" :data-testid="`ciclo-avaliacao-${v.id}`">
                <th scope="row">{{ v.colaborador }}</th>
                <td>{{ v.numero }}</td>
                <td>{{ v.avaliador }}</td>
                <td>
                  {{ t(`pessoas.avaliacao.situacoesAvaliacao.${v.situacao}`) }}
                  <span v-if="v.substituida" class="secundario"
                    >({{ t('pessoas.avaliacao.substituida') }})</span
                  >
                </td>
                <td>
                  <SanteBotao
                    :rotulo="t('pessoas.avaliacao.abrir', { nome: `${v.colaborador} (${v.numero})` })"
                    variante="texto"
                    :data-testid="`abrir-avaliacao-${v.id}`"
                    @acionar="emit('abrir', v.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="f" class="bloco" data-testid="ciclo-historico">
          <h3>{{ t('pessoas.avaliacao.historico.titulo') }}</h3>
          <p v-if="f.correcoes.length === 0" class="secundario">
            {{ t('pessoas.avaliacao.historico.vazio') }}
          </p>
          <ul v-else>
            <li v-for="h in f.correcoes" :key="h.id" :data-testid="`ciclo-correcao-${h.id}`">
              {{
                t('pessoas.avaliacao.historico.linha', {
                  em: quando(h.em),
                  por: h.por,
                  operacao: nomeOperacao(h.operacao),
                })
              }}
              <div class="secundario">{{ h.motivo }}</div>
              <ul class="secundario">
                <li v-for="m in mudancasDaCorrecao(h, txt)" :key="m.campo">
                  {{ t('pessoas.avaliacao.historico.mudanca', m) }}
                </li>
              </ul>
            </li>
          </ul>
        </section>
      </template>
    </section>

    <AbrirAvaliacao
      v-model:visivel="dialogoAbrir"
      :ciclos="ciclos"
      :ciclo="c?.id ?? null"
      @aberta="aposAbrirAvaliacao"
    />
    <DialogoMotivo
      v-model:visivel="dialogoAlterar"
      :titulo="t('pessoas.avaliacao.ciclos.alterarTitulo')"
      :texto="t('pessoas.avaliacao.ciclos.alterarTexto')"
      :confirmar="t('pessoas.avaliacao.ciclos.alterar')"
      variante="primario"
      :acao="alterar"
      testid="dialogo-alterar-ciclo"
      @feito="emit('gravado', $event)"
    />
    <DialogoMotivo
      v-model:visivel="dialogoSituacao"
      :titulo="t(`pessoas.avaliacao.ciclos.passar.${destino}`)"
      :texto="t(`pessoas.avaliacao.ciclos.passarTexto.${destino}`)"
      :confirmar="t(`pessoas.avaliacao.ciclos.passar.${destino}`)"
      :variante="destino === 'aberto' ? 'primario' : 'destrutivo'"
      :acao="mudarSituacao"
      testid="dialogo-situacao-ciclo"
      @feito="emit('gravado', $event)"
    />
    <DialogoMotivo
      v-model:visivel="dialogoExclusao"
      :titulo="t('pessoas.avaliacao.exclusao.titulo')"
      :texto="t('pessoas.avaliacao.exclusao.textoCiclo')"
      :confirmar="t('pessoas.avaliacao.excluir')"
      :acao="excluir"
      testid="dialogo-excluir-ciclo"
      @feito="aposExcluir"
    >
      <template #recusa="{ codigo }">
        <SanteBotao
          v-if="codigo.endsWith('-com-vinculos') && c?.situacao !== 'cancelado'"
          :rotulo="t('pessoas.avaliacao.exclusao.cancelarEmVez')"
          variante="secundario"
          data-testid="cancelar-em-vez"
          @acionar="cancelarEmVez"
        />
      </template>
    </DialogoMotivo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
