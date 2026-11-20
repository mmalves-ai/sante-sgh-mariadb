<script setup lang="ts">
// Aba "Competências" da avaliação de desempenho (W0-06, parte 5d): a lista das competências com os cargos avaliados
// em cada uma e a ficha (nome e descrição; alteração com motivo e o valor anterior no histórico; inativar/reativar com
// motivo; excluir a nunca usada, com a inativação oferecida no 409; ligar ao cargo e retirar do cargo com motivo).
import {
  type ApoioAvaliacao,
  type CompetenciaResposta,
  type CorrecaoResposta,
  esquemaIncluirCompetencia,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import {
  alterarCompetencia,
  desligarCompetenciaCargo,
  excluirCompetencia,
  incluirCompetencia,
  lerCompetencias,
  ligarCompetenciaCargo,
  situacaoCompetencia,
} from './api-avaliacao.js';
import { mudancasDaCorrecao } from './avaliacao-comum.js';

const props = defineProps<{ apoio: ApoioAvaliacao }>();
const emit = defineEmits<{ gravado: [r: unknown] }>();
const { t, te } = useI18n();
const pode = computed(() => props.apoio.acoes.gerir);
const lista = useQuery({ queryKey: ['pessoas', 'avaliacao', 'competencias'], queryFn: lerCompetencias });
const competencias = computed(() => lista.data.value?.competencias ?? []);

const selecionada = ref<number | 'nova' | null>(null);
const k = computed<CompetenciaResposta | null>(
  () => competencias.value.find((x) => x.id === selecionada.value) ?? null,
);
const nomeCargo = (id: number): string => props.apoio.cargos.find((c) => c.codigo === id)?.rotulo ?? `#${id}`;

const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const form = ref({ nome: '', descricao: '' });
watch(k, (x) => {
  if (x) form.value = { nome: x.nome, descricao: x.descricao ?? '' };
});
function abrir(id: number | 'nova'): void {
  erro.value = null;
  aviso.value = null;
  selecionada.value = id;
  const x = competencias.value.find((c) => c.id === id);
  form.value = { nome: x?.nome ?? '', descricao: x?.descricao ?? '' };
}
function validar(): boolean {
  const r = esquemaIncluirCompetencia.safeParse(form.value);
  aviso.value = r.success ? null : (r.error.issues[0]?.message ?? null);
  return r.success;
}
const dialogoAlterar = ref(false);
async function gravar(): Promise<void> {
  erro.value = null;
  if (!validar()) return;
  if (selecionada.value !== 'nova') {
    dialogoAlterar.value = true;
    return;
  }
  ocupado.value = true;
  try {
    const r = await incluirCompetencia(esquemaIncluirCompetencia.parse(form.value));
    emit('gravado', r);
    selecionada.value = r.id;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const alterar = (motivo: string) =>
  alterarCompetencia({
    ...esquemaIncluirCompetencia.parse(form.value),
    competencia: k.value!.id,
    versao: k.value!.versao,
    motivo,
  });

// ── Situação e exclusão ──
const dialogoSituacao = ref(false);
const mudarSituacao = (motivo: string) =>
  situacaoCompetencia({ competencia: k.value!.id, versao: k.value!.versao, ativo: !k.value!.ativo, motivo });
const dialogoExclusao = ref(false);
const excluir = (motivo: string) =>
  excluirCompetencia({ competencia: k.value!.id, versao: k.value!.versao, motivo });
function aposExcluir(r: unknown): void {
  selecionada.value = null;
  emit('gravado', r);
}
function inativarEmVez(): void {
  dialogoExclusao.value = false;
  dialogoSituacao.value = true;
}

// ── Cargos ligados ──
const cargoParaLigar = ref<number | null>(null);
const opcoesCargo = computed(() => [
  { valor: null, rotulo: '—' },
  ...props.apoio.cargos
    .filter((c) => !(k.value?.cargos ?? []).includes(c.codigo))
    .map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
]);
async function ligar(): Promise<void> {
  if (!k.value || cargoParaLigar.value === null) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await ligarCompetenciaCargo({ cargo: cargoParaLigar.value, competencia: k.value.id });
    cargoParaLigar.value = null;
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const cargoDesligar = ref<number | null>(null);
const dialogoDesligar = ref(false);
function pedirDesligar(cargo: number): void {
  cargoDesligar.value = cargo;
  dialogoDesligar.value = true;
}
const desligar = (motivo: string) =>
  desligarCompetenciaCargo({ cargo: cargoDesligar.value!, competencia: k.value!.id, motivo });

// ── Histórico ──
const correcoes = computed<CorrecaoResposta[]>(() =>
  (lista.data.value?.correcoes ?? []).filter((c) => c.registro === k.value?.id),
);
const txt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
};
const nomeOperacao = (op: string): string => {
  const chave = `pessoas.avaliacao.historico.operacoes.${op.replace('.', '_')}`;
  return te(chave) ? t(chave) : op;
};
const quando = (em: string) => `${dataBr(em.slice(0, 10))} ${em.slice(11, 16)}`;
</script>

<template>
  <section class="bloco" data-testid="aval-competencias">
    <ErroPessoas v-if="erro" :erro="erro" />
    <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.data.value && competencias.length === 0" data-testid="competencias-vazio">
      {{ t('pessoas.avaliacao.competencias.vazio') }}
    </p>
    <table v-else-if="competencias.length > 0" class="tabela" data-testid="tabela-competencias">
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.avaliacao.competencias.nome') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.competencias.cargos') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.competencias.situacao') }}</th>
          <th scope="col">{{ t('pessoas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in competencias" :key="c.id" :data-testid="`competencia-${c.id}`">
          <th scope="row">{{ c.nome }}</th>
          <td>
            {{
              c.cargos.length === 0
                ? t('pessoas.avaliacao.competencias.semCargo')
                : c.cargos.map(nomeCargo).join(', ')
            }}
          </td>
          <td>{{ c.ativo ? t('pessoas.avaliacao.ativa') : t('pessoas.avaliacao.inativa') }}</td>
          <td>
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.abrir', { nome: c.nome })"
              variante="texto"
              :data-testid="`abrir-competencia-${c.id}`"
              @acionar="abrir(c.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="pode" class="acoes">
      <SanteBotao
        :rotulo="t('pessoas.avaliacao.competencias.nova')"
        variante="secundario"
        data-testid="nova-competencia"
        @acionar="abrir('nova')"
      />
    </div>

    <section
      v-if="selecionada === 'nova' || k"
      class="bloco"
      aria-labelledby="pes-aval-competencia"
      data-testid="ficha-competencia"
    >
      <h2 id="pes-aval-competencia">
        {{ selecionada === 'nova' ? t('pessoas.avaliacao.competencias.tituloNova') : k?.nome }}
      </h2>
      <p v-if="k" class="secundario" data-testid="competencia-situacao">
        {{
          k.ativo
            ? t('pessoas.avaliacao.alteradoPor', { por: k.alteradoPor, em: quando(k.alteradoEm) })
            : t('pessoas.avaliacao.competencias.inativaMotivo', { motivo: k.motivoSituacao ?? '' })
        }}
      </p>
      <form class="bloco" data-testid="form-competencia" @submit.prevent="gravar">
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <SanteCampoTexto
          v-model="form.nome"
          :rotulo="t('pessoas.avaliacao.competencias.nome')"
          :max-bytes="80"
          obrigatorio
          data-testid="competencia-nome"
        />
        <SanteCampoTexto
          v-model="form.descricao"
          :rotulo="t('pessoas.avaliacao.competencias.descricao')"
          :max-bytes="2000"
          multilinha
          data-testid="competencia-descricao"
        />
        <div v-if="pode" class="acoes">
          <SanteBotao
            :rotulo="
              selecionada === 'nova'
                ? t('pessoas.avaliacao.competencias.incluir')
                : t('pessoas.avaliacao.competencias.alterar')
            "
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="gravar-competencia"
          />
          <template v-if="k">
            <SanteBotao
              :rotulo="k.ativo ? t('pessoas.avaliacao.inativar') : t('pessoas.avaliacao.reativar')"
              variante="secundario"
              data-testid="situacao-competencia"
              @acionar="dialogoSituacao = true"
            />
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.excluir')"
              variante="texto"
              data-testid="excluir-competencia"
              @acionar="dialogoExclusao = true"
            />
          </template>
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.fechar')"
            variante="texto"
            @acionar="selecionada = null"
          />
        </div>
      </form>

      <section v-if="k" class="bloco" data-testid="competencia-cargos">
        <h3>{{ t('pessoas.avaliacao.competencias.cargosDaCompetencia') }}</h3>
        <p v-if="k.cargos.length === 0" class="secundario">
          {{ t('pessoas.avaliacao.competencias.semCargo') }}
        </p>
        <ul v-else>
          <li v-for="c in k.cargos" :key="c" :data-testid="`competencia-cargo-${c}`">
            {{ nomeCargo(c) }}
            <SanteBotao
              v-if="pode"
              :rotulo="t('pessoas.avaliacao.competencias.desligar', { cargo: nomeCargo(c) })"
              variante="texto"
              :data-testid="`desligar-cargo-${c}`"
              @acionar="pedirDesligar(c)"
            />
          </li>
        </ul>
        <div v-if="pode && k.ativo" class="campos">
          <SanteSelecao
            v-model="cargoParaLigar"
            :rotulo="t('pessoas.avaliacao.competencias.ligarCargo')"
            :opcoes="opcoesCargo"
            busca
            data-testid="competencia-ligar-cargo"
          />
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.competencias.ligar')"
            variante="secundario"
            :desabilitado="ocupado || cargoParaLigar === null"
            data-testid="ligar-cargo"
            @acionar="ligar"
          />
        </div>
      </section>

      <section v-if="k" class="bloco" data-testid="competencia-historico">
        <h3>{{ t('pessoas.avaliacao.historico.titulo') }}</h3>
        <p v-if="correcoes.length === 0" class="secundario">{{ t('pessoas.avaliacao.historico.vazio') }}</p>
        <ul v-else>
          <li v-for="c in correcoes" :key="c.id" :data-testid="`competencia-correcao-${c.id}`">
            {{
              t('pessoas.avaliacao.historico.linha', {
                em: quando(c.em),
                por: c.por,
                operacao: nomeOperacao(c.operacao),
              })
            }}
            <div class="secundario">{{ c.motivo }}</div>
            <ul class="secundario">
              <li v-for="m in mudancasDaCorrecao(c, txt)" :key="m.campo">
                {{ t('pessoas.avaliacao.historico.mudanca', m) }}
              </li>
            </ul>
          </li>
        </ul>
      </section>
    </section>

    <DialogoMotivo
      v-model:visivel="dialogoAlterar"
      :titulo="t('pessoas.avaliacao.competencias.alterarTitulo')"
      :texto="t('pessoas.avaliacao.competencias.alterarTexto')"
      :confirmar="t('pessoas.avaliacao.competencias.alterar')"
      variante="primario"
      :acao="alterar"
      testid="dialogo-alterar-competencia"
      @feito="emit('gravado', $event)"
    />
    <DialogoMotivo
      v-model:visivel="dialogoSituacao"
      :titulo="
        k?.ativo
          ? t('pessoas.avaliacao.situacao.inativarTitulo')
          : t('pessoas.avaliacao.situacao.reativarTitulo')
      "
      :texto="
        k?.ativo
          ? t('pessoas.avaliacao.situacao.inativarTexto')
          : t('pessoas.avaliacao.situacao.reativarTexto')
      "
      :confirmar="k?.ativo ? t('pessoas.avaliacao.inativar') : t('pessoas.avaliacao.reativar')"
      :variante="k?.ativo ? 'destrutivo' : 'primario'"
      :acao="mudarSituacao"
      testid="dialogo-situacao-competencia"
      @feito="emit('gravado', $event)"
    />
    <DialogoMotivo
      v-model:visivel="dialogoExclusao"
      :titulo="t('pessoas.avaliacao.exclusao.titulo')"
      :texto="t('pessoas.avaliacao.exclusao.texto')"
      :confirmar="t('pessoas.avaliacao.excluir')"
      :acao="excluir"
      testid="dialogo-excluir-competencia"
      @feito="aposExcluir"
    >
      <template #recusa="{ codigo }">
        <SanteBotao
          v-if="codigo.endsWith('-com-vinculos') && k?.ativo"
          :rotulo="t('pessoas.avaliacao.exclusao.inativarEmVez')"
          variante="secundario"
          data-testid="inativar-em-vez"
          @acionar="inativarEmVez"
        />
      </template>
    </DialogoMotivo>
    <DialogoMotivo
      v-model:visivel="dialogoDesligar"
      :titulo="t('pessoas.avaliacao.competencias.desligarTitulo')"
      :texto="t('pessoas.avaliacao.competencias.desligarTexto')"
      :confirmar="
        t('pessoas.avaliacao.competencias.desligar', { cargo: cargoDesligar ? nomeCargo(cargoDesligar) : '' })
      "
      :acao="desligar"
      testid="dialogo-desligar-cargo"
      @feito="emit('gravado', $event)"
    />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
