<script setup lang="ts">
// Desempenho e desenvolvimento na ficha do colaborador (W0-06, parte 5d-3; M2 de mercado; leitura com
// `pessoas.avaliacao.ler`, gravação com `pessoas.avaliacao.gerir` e a chave `pessoas.colaborador` ligada): as
// avaliações do colaborador (todas as versões, abertas na mesma ficha da avaliação) e o PDI, com as ações ligadas à
// competência, ao curso (e a conclusão dele numa turma) e à avaliação de origem. Incluir; alterar a aberta com motivo
// (o valor anterior fica no histórico do PDI); concluir (com a data) ou cancelar com motivo. Nada do PDI se exclui:
// a ação lançada por engano se cancela, com o motivo à vista.
import {
  type AlterarPdiEntrada,
  esquemaAlterarPdi,
  esquemaIncluirPdi,
  type IncluirPdiEntrada,
  type PdiResposta,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import {
  alterarPdi,
  incluirPdi,
  lerApoioAvaliacao,
  lerAvaliacoesDoColaborador,
  lerCiclos,
  lerCompetencias,
  situacaoPdi,
} from './api-avaliacao.js';
import {
  conclusaoSugerida,
  dadosDoPdi,
  type FormPdi,
  formDoPdi,
  formPdiVazio,
  mudancasDaCorrecao,
  pdiAtrasado,
} from './avaliacao-comum.js';
import FichaAvaliacao from './FichaAvaliacao.vue';

const props = defineProps<{ vinculo: number; ativo: boolean }>();
const { t, te } = useI18n();
const qc = useQueryClient();

const apoio = useQuery({ queryKey: ['pessoas', 'avaliacao', 'apoio'], queryFn: lerApoioAvaliacao });
const dados = useQuery({
  queryKey: computed(() => ['pessoas', 'avaliacao', 'colaborador', props.vinculo]),
  queryFn: () => lerAvaliacoesDoColaborador(props.vinculo),
});
const ciclos = useQuery({ queryKey: ['pessoas', 'avaliacao', 'ciclos'], queryFn: lerCiclos });
const ap = computed(() => apoio.data.value ?? null);
const pode = computed(() => !!ap.value?.acoes.gerir && !!ap.value?.gravacao.ligada);
const competencias = useQuery({
  queryKey: ['pessoas', 'avaliacao', 'competencias'],
  queryFn: lerCompetencias,
  enabled: pode,
});
const hoje = computed(() => ap.value?.hoje ?? new Date().toISOString().slice(0, 10));
const avaliacoes = computed(() => dados.data.value?.avaliacoes ?? []);
const pdi = computed(() => dados.data.value?.pdi ?? []);
const nomeCiclo = (id: number): string => ciclos.data.value?.find((c) => c.id === id)?.nome ?? `#${id}`;

const resultado = ref<string | null>(null);
async function aposGravar(r: unknown): Promise<void> {
  const m = (r as { mensagem?: unknown } | null)?.mensagem;
  resultado.value = typeof m === 'string' ? m : null;
  await qc.invalidateQueries({ queryKey: ['pessoas', 'avaliacao'] });
}

/** A avaliação aberta na ficha (a correção troca para a versão nova; a exclusão fecha). */
const aberta = ref<number | null>(null);

// ── Incluir e alterar a ação do PDI ──
const editando = ref<PdiResposta | 'nova' | null>(null);
const dialogo = computed({
  get: () => editando.value !== null,
  set: (v: boolean) => {
    if (!v) editando.value = null;
  },
});
const form = ref<FormPdi>(formPdiVazio());
const motivo = ref('');
const erroForm = ref<unknown>(null);
const ocupado = ref(false);
function abrirForm(p: PdiResposta | 'nova'): void {
  form.value = p === 'nova' ? formPdiVazio() : formDoPdi(p);
  motivo.value = '';
  erroForm.value = null;
  resultado.value = null;
  editando.value = p;
}
const entrada = computed(() => {
  const e = editando.value;
  if (e === null) return null;
  return e === 'nova'
    ? esquemaIncluirPdi.safeParse({ ...dadosDoPdi(form.value), vinculo: props.vinculo })
    : esquemaAlterarPdi.safeParse({
        ...dadosDoPdi(form.value),
        pdi: e.id,
        versao: e.versao,
        motivo: motivo.value,
      });
});
const avisoForm = computed(() => {
  const r = entrada.value;
  if (!r || r.success) return null;
  const preenchido = form.value.acao.trim() !== '' || form.value.prazo !== null;
  return preenchido ? (r.error.issues[0]?.message ?? null) : null;
});
async function gravar(): Promise<void> {
  const r = entrada.value;
  if (!r?.success) return;
  erroForm.value = null;
  ocupado.value = true;
  try {
    const feito =
      editando.value === 'nova'
        ? await incluirPdi(r.data as IncluirPdiEntrada)
        : await alterarPdi(r.data as AlterarPdiEntrada);
    editando.value = null;
    await aposGravar(feito);
  } catch (e) {
    erroForm.value = e;
  } finally {
    ocupado.value = false;
  }
}
const opcoesCompetencia = computed(() => {
  const atual = typeof editando.value === 'object' && editando.value ? editando.value.competencia : null;
  return [
    { valor: null, rotulo: t('pessoas.avaliacao.colaborador.semCompetencia') },
    ...(competencias.data.value?.competencias ?? [])
      .filter((k) => k.ativo || k.id === atual)
      .map((k) => ({ valor: k.id, rotulo: k.nome })),
  ];
});
const opcoesCurso = computed(() => [
  { valor: null, rotulo: t('pessoas.avaliacao.colaborador.semCurso') },
  ...(ap.value?.cursos ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
]);
const opcoesAvaliacao = computed(() => [
  { valor: null, rotulo: t('pessoas.avaliacao.colaborador.semAvaliacao') },
  ...avaliacoes.value
    .filter((a) => !a.substituida)
    .map((a) => ({
      valor: a.id,
      rotulo: t('pessoas.avaliacao.colaborador.avaliacaoOpcao', {
        numero: a.numero,
        ciclo: nomeCiclo(a.ciclo),
        situacao: t(`pessoas.avaliacao.situacoesAvaliacao.${a.situacao}`),
      }),
    })),
]);

// ── Concluir ou cancelar ──
const fechando = ref<{ p: PdiResposta; situacao: 'concluida' | 'cancelada' } | null>(null);
const dialogoFechar = computed({
  get: () => fechando.value !== null,
  set: (v: boolean) => {
    if (!v) fechando.value = null;
  },
});
const concluidaEm = ref<string | null>(null);
function pedirFechar(p: PdiResposta, situacao: 'concluida' | 'cancelada'): void {
  resultado.value = null;
  concluidaEm.value = situacao === 'concluida' ? conclusaoSugerida(p, hoje.value) : null;
  fechando.value = { p, situacao };
}
const fechar = (m: string) => {
  const x = fechando.value!;
  return situacaoPdi({
    pdi: x.p.id,
    versao: x.p.versao,
    situacao: x.situacao,
    concluidaEm: x.situacao === 'concluida' ? concluidaEm.value : null,
    motivo: m,
  });
};

// ── Histórico do PDI ──
const txt = (v: unknown, campo: string): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'prazo' && typeof v === 'string') return dataBr(v);
  if (campo === 'curso') return ap.value?.cursos.find((c) => c.codigo === v)?.rotulo ?? String(v);
  if (campo === 'competencia')
    return competencias.data.value?.competencias.find((k) => k.id === v)?.nome ?? String(v);
  if (campo === 'situacao') {
    const chave = `pessoas.avaliacao.colaborador.situacoes.${String(v)}`;
    return te(chave) ? t(chave) : String(v);
  }
  return String(v);
};
const nomeOperacao = (op: string): string => {
  const chave = `pessoas.avaliacao.historico.operacoes.${op.replace('.', '_')}`;
  return te(chave) ? t(chave) : op;
};
const quando = (em: string | null) => (em ? `${dataBr(em.slice(0, 10))} ${em.slice(11, 16)}` : '—');
</script>

<template>
  <section class="bloco" aria-labelledby="pes-ficha-desempenho" data-testid="ficha-desempenho">
    <h2 id="pes-ficha-desempenho">{{ t('pessoas.avaliacao.colaborador.titulo') }}</h2>
    <SanteAlerta
      v-if="resultado"
      :texto="resultado"
      variante="info"
      anunciar
      data-testid="desempenho-resultado"
    />
    <SanteAlerta
      v-if="ap && ap.acoes.gerir && !ap.gravacao.ligada"
      :texto="ap.gravacao.motivo ?? t('pessoas.gravacaoDesligada')"
      variante="aviso"
    />
    <ErroPessoas v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <h3>{{ t('pessoas.avaliacao.colaborador.avaliacoes') }}</h3>
      <p v-if="avaliacoes.length === 0" class="secundario" data-testid="desempenho-sem-avaliacoes">
        {{ t('pessoas.avaliacao.colaborador.semAvaliacoes') }}
      </p>
      <table v-else class="tabela" data-testid="desempenho-avaliacoes">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.ciclo') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.numero') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.ciclos.avaliador') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.situacao') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.quando') }}</th>
            <th scope="col">{{ t('pessoas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in avaliacoes" :key="a.id" :data-testid="`desempenho-avaliacao-${a.id}`">
            <th scope="row">
              {{ nomeCiclo(a.ciclo) }}
              <span v-if="a.marco" class="secundario">
                {{ t('pessoas.avaliacao.ficha.marcoTexto', { m: a.marco }) }}</span
              >
            </th>
            <td>{{ a.numero }}</td>
            <td>{{ a.avaliador }}</td>
            <td>
              {{ t(`pessoas.avaliacao.situacoesAvaliacao.${a.situacao}`) }}
              <span v-if="a.substituida" class="secundario">({{ t('pessoas.avaliacao.substituida') }})</span>
            </td>
            <td>{{ quando(a.finalizadaEm) }}</td>
            <td>
              <SanteBotao
                :rotulo="
                  t('pessoas.avaliacao.colaborador.abrirAvaliacao', {
                    numero: a.numero,
                    ciclo: nomeCiclo(a.ciclo),
                  })
                "
                variante="texto"
                :data-testid="`desempenho-abrir-${a.id}`"
                @acionar="aberta = a.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <FichaAvaliacao v-if="aberta !== null" v-model:id="aberta" @gravado="aposGravar" />

      <h3>{{ t('pessoas.avaliacao.colaborador.pdi') }}</h3>
      <p v-if="pdi.length === 0" class="secundario" data-testid="pdi-vazio">
        {{ t('pessoas.avaliacao.colaborador.semPdi') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-pdi">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.acao') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.competencia') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.curso') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.prazo') }}</th>
            <th scope="col">{{ t('pessoas.avaliacao.colaborador.situacao') }}</th>
            <th scope="col">{{ t('pessoas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pdi" :key="p.id" :data-testid="`pdi-${p.id}`" :data-situacao="p.situacao">
            <th scope="row">{{ p.acao }}</th>
            <td>{{ p.competenciaNome ?? '—' }}</td>
            <td>
              <template v-if="p.cursoTitulo">
                {{ p.cursoTitulo }}
                <div class="secundario" :data-testid="`pdi-${p.id}-curso`">
                  {{
                    p.cursoConcluidoEm
                      ? t('pessoas.avaliacao.colaborador.cursoConcluido', {
                          data: dataBr(p.cursoConcluidoEm.slice(0, 10)),
                        })
                      : t('pessoas.avaliacao.colaborador.cursoPendente')
                  }}
                </div>
              </template>
              <template v-else>—</template>
            </td>
            <td>
              {{ dataBr(p.prazo) }}
              <span v-if="pdiAtrasado(p, hoje)" class="secundario">
                ({{ t('pessoas.avaliacao.colaborador.atrasada') }})</span
              >
            </td>
            <td :data-testid="`pdi-${p.id}-situacao`">
              {{ t(`pessoas.avaliacao.colaborador.situacoes.${p.situacao}`) }}
              <div v-if="p.situacao !== 'aberta'" class="secundario">
                {{
                  t('pessoas.avaliacao.colaborador.fechadaEm', {
                    situacao: t(`pessoas.avaliacao.colaborador.situacoes.${p.situacao}`),
                    data: p.concluidaEm ? dataBr(p.concluidaEm) : quando(p.alteradoEm),
                    motivo: p.motivoSituacao ?? '',
                  })
                }}
              </div>
            </td>
            <td>
              <template v-if="pode && p.situacao === 'aberta'">
                <SanteBotao
                  :rotulo="t('pessoas.avaliacao.colaborador.alterarAcao', { id: p.id })"
                  variante="texto"
                  :data-testid="`pdi-alterar-${p.id}`"
                  @acionar="abrirForm(p)"
                />
                <SanteBotao
                  :rotulo="t('pessoas.avaliacao.colaborador.concluirAcao', { id: p.id })"
                  variante="texto"
                  :data-testid="`pdi-concluir-${p.id}`"
                  @acionar="pedirFechar(p, 'concluida')"
                />
                <SanteBotao
                  :rotulo="t('pessoas.avaliacao.colaborador.cancelarAcao', { id: p.id })"
                  variante="texto"
                  :data-testid="`pdi-cancelar-${p.id}`"
                  @acionar="pedirFechar(p, 'cancelada')"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="pode && ativo" class="acoes">
        <SanteBotao
          :rotulo="t('pessoas.avaliacao.colaborador.novaAcao')"
          variante="secundario"
          data-testid="pdi-nova"
          @acionar="abrirForm('nova')"
        />
      </div>

      <section class="bloco" data-testid="pdi-historico">
        <h3>{{ t('pessoas.avaliacao.colaborador.historico') }}</h3>
        <p v-if="dados.data.value.correcoes.length === 0" class="secundario">
          {{ t('pessoas.avaliacao.historico.vazio') }}
        </p>
        <ul v-else>
          <li v-for="c in dados.data.value.correcoes" :key="c.id" :data-testid="`pdi-correcao-${c.id}`">
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
    </template>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        editando === 'nova'
          ? t('pessoas.avaliacao.colaborador.incluirTitulo')
          : t('pessoas.avaliacao.colaborador.alterarTitulo')
      "
    >
      <form class="bloco" data-testid="form-pdi" @submit.prevent="gravar">
        <p v-if="editando !== 'nova'" class="secundario">
          {{ t('pessoas.avaliacao.colaborador.alterarAjuda') }}
        </p>
        <SanteAlerta v-if="avisoForm" :texto="avisoForm" variante="aviso" />
        <SanteCampoTexto
          v-model="form.acao"
          :rotulo="t('pessoas.avaliacao.colaborador.acao')"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="pdi-acao"
        />
        <SanteSelecao
          v-model="form.competencia"
          :rotulo="t('pessoas.avaliacao.colaborador.competencia')"
          :opcoes="opcoesCompetencia"
          busca
          data-testid="pdi-competencia"
        />
        <SanteSelecao
          v-model="form.curso"
          :rotulo="t('pessoas.avaliacao.colaborador.curso')"
          :opcoes="opcoesCurso"
          busca
          data-testid="pdi-curso"
        />
        <SanteSelecao
          v-model="form.avaliacao"
          :rotulo="t('pessoas.avaliacao.colaborador.avaliacao')"
          :opcoes="opcoesAvaliacao"
          data-testid="pdi-avaliacao"
        />
        <SanteData
          v-model="form.prazo"
          :rotulo="t('pessoas.avaliacao.colaborador.prazo')"
          editavel
          data-testid="pdi-prazo"
        />
        <template v-if="editando !== 'nova'">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('pessoas.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="pdi-motivo"
          />
          <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
        </template>
        <ErroPessoas v-if="erroForm" :erro="erroForm" />
        <div class="acoes">
          <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="editando = null" />
          <SanteBotao
            :rotulo="
              editando === 'nova'
                ? t('pessoas.avaliacao.colaborador.incluir')
                : t('pessoas.avaliacao.colaborador.alterar')
            "
            tipo="submit"
            :desabilitado="ocupado || !entrada?.success"
            data-testid="pdi-gravar"
          />
        </div>
      </form>
    </SanteDialogo>

    <DialogoMotivo
      v-model:visivel="dialogoFechar"
      :titulo="
        fechando?.situacao === 'concluida'
          ? t('pessoas.avaliacao.colaborador.concluirTitulo')
          : t('pessoas.avaliacao.colaborador.cancelar')
      "
      :texto="
        fechando?.situacao === 'concluida'
          ? t('pessoas.avaliacao.colaborador.concluirTexto')
          : t('pessoas.avaliacao.colaborador.cancelarTexto')
      "
      :confirmar="
        fechando?.situacao === 'concluida'
          ? t('pessoas.avaliacao.colaborador.concluir')
          : t('pessoas.avaliacao.colaborador.cancelar')
      "
      :variante="fechando?.situacao === 'concluida' ? 'primario' : 'destrutivo'"
      :acao="fechar"
      :pronto="fechando?.situacao !== 'concluida' || !!concluidaEm"
      testid="dialogo-pdi-situacao"
      @feito="aposGravar"
    >
      <SanteData
        v-if="fechando?.situacao === 'concluida'"
        v-model="concluidaEm"
        :rotulo="t('pessoas.avaliacao.colaborador.concluidaEm')"
        editavel
        :maximo="hoje"
        data-testid="pdi-concluida-em"
      />
    </DialogoMotivo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
