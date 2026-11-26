<script setup lang="ts">
// Ficha do solicitante externo (F3.1, 02-CAD linha 20): dados editáveis (o registro no conselho fica), o que falta
// para a guia, os cadastros parecidos (regra do domínio), inativar e reativar com o motivo (nunca apagar) e o código
// do solicitante em cada fonte pagadora. Tudo numa tela só; a recusa da API aparece junto do campo.
// Unificação do duplicado: a partir da lista de parecidos, com o motivo, sem sair da ficha; o duplicado fica inativo e
// aponta para este cadastro (atendimentos e pedidos já feitos não mudam) e a unificação pode ser desfeita na ficha dele.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarSolicitante,
  desfazerUnificacaoSolicitante,
  gravarCodigoNaFonte,
  lerFichaSolicitante,
  mudarSituacaoSolicitante,
  type Parecido,
  unificarSolicitante,
} from '../api-ligacoes.js';
import { lerOpcoes } from '../api-vinculos.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const editar = computed(() => pode('cadastro.solicitante.editar'));
const chaveQ = computed(() => ['cadastro', 'solicitante', props.id]);
const consulta = useQuery({ queryKey: chaveQ, queryFn: () => lerFichaSolicitante(Number(props.id)) });
const f = computed(() => consulta.data.value);
const fontes = useQuery({ queryKey: ['cadastro', 'vinculos-opcoes'], queryFn: lerOpcoes, enabled: editar });
const CAMPOS = [
  'nome',
  'conselho',
  'uf',
  'numero',
  'cpf',
  'cns',
  'instituicaoNome',
  'instituicaoCnes',
  'telefone',
  'email',
  'observacao',
] as const;
const dados = ref<Record<string, string>>({});
watch(
  f,
  (x) => {
    if (x) dados.value = Object.fromEntries(CAMPOS.map((c) => [c, String(x[c] ?? '')]));
  },
  { immediate: true },
);
const motivo = ref('');
const fonte = ref<number | null>(null);
const codigo = ref('');
const erro = ref<unknown>(null);
const ok = ref(false);
// Unificação: o parecido escolhido e o motivo (um de cada vez, na própria lista).
const duplicado = ref<Parecido | null>(null);
const motivoUnificar = ref('');
const motivoDesfazer = ref('');
const podeUnificar = computed(() => editar.value && !!f.value?.ativo && !f.value?.unificadoEm);
const camposDaUnificacao = (campos: readonly string[]) =>
  campos.map((c) => t(`ligacoes.solicitante.campoUnificacao.${c}`)).join(', ');
function escolherDuplicado(p: Parecido | null): void {
  duplicado.value = p;
  motivoUnificar.value = '';
}
async function unificar(): Promise<void> {
  const d = duplicado.value;
  if (!d) return;
  await fazer(() =>
    unificarSolicitante(Number(props.id), {
      absorvido: d.id,
      versao: d.versao ?? 0,
      motivo: motivoUnificar.value,
    }),
  );
  if (ok.value) escolherDuplicado(null);
}
async function desfazer(): Promise<void> {
  await fazer(() =>
    desfazerUnificacaoSolicitante(Number(props.id), {
      versao: f.value!.versao,
      motivo: motivoDesfazer.value,
    }),
  );
  if (ok.value) motivoDesfazer.value = '';
}

async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ok.value = false;
  try {
    await fn();
    ok.value = true;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
const gravarDados = () =>
  fazer(() =>
    alterarSolicitante(Number(props.id), {
      ...dados.value,
      versao: f.value!.versao,
      ocupacao: f.value!.ocupacao,
      especialidade: f.value!.especialidade,
      instituicaoCnpj: f.value!.instituicaoCnpj,
    }),
  );
</script>

<template>
  <div class="tela" data-testid="tela-solicitante">
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-if="f">
      <h1>{{ t('ligacoes.solicitante.titulo') }}: {{ f.nome }}</h1>
      <p>
        {{ t('ligacoes.solicitante.registro') }}: {{ f.conselho }} {{ f.numero
        }}<template v-if="f.uf">/{{ f.uf }}</template
        ><span v-else data-testid="solicitante-sem-uf">
          ({{ t('ligacoes.solicitante.ufNaoInformada', 'UF não informada na origem') }})</span
        >
        <span v-if="!f.ativo" class="pilula pilula--neutra" data-testid="solicitante-inativo">
          {{ t('ligacoes.solicitante.inativo', { data: f.dataInativacao ?? '' }) }}
        </span>
      </p>
      <section
        v-if="f.unificadoEm"
        class="aviso"
        data-testid="solicitante-unificado"
        aria-labelledby="sol-unificado"
      >
        <p id="sol-unificado">
          {{ t('ligacoes.solicitante.unificadoEm') }}
          <RouterLink :to="`/cadastros/solicitantes/${f.unificadoEm.id}`" data-testid="sol-unificado-em">{{
            f.unificadoEm.nome
          }}</RouterLink>
          — {{ f.unificadoEm.registro }}
          <template v-if="f.unificadoEm.quando">
            {{ t('ligacoes.solicitante.unificadoDesde', { data: f.unificadoEm.quando }) }}
          </template>
        </p>
        <div v-if="editar" class="barra">
          <div class="campo">
            <label for="sol-motivo-desfazer">{{ t('ligacoes.solicitante.desfazerMotivo') }}</label>
            <input
              id="sol-motivo-desfazer"
              v-model="motivoDesfazer"
              maxlength="200"
              data-testid="sol-motivo-desfazer"
            />
          </div>
          <SanteBotao
            :rotulo="t('ligacoes.solicitante.desfazer')"
            variante="secundario"
            :desabilitado="motivoDesfazer.trim().length < 10"
            data-testid="sol-desfazer-unificacao"
            @acionar="desfazer"
          />
        </div>
      </section>
      <p v-if="f.faltaParaGuia.length" class="aviso" data-testid="solicitante-falta-guia">
        {{ t('ligacoes.solicitante.faltaGuia', { campos: f.faltaParaGuia.join(', ') }) }}
      </p>
      <MensagemErro v-if="erro" :erro="erro" data-testid="solicitante-erro" />
      <p v-if="ok" role="status">{{ t('ligacoes.comum.gravado') }}</p>

      <section aria-labelledby="sol-dados">
        <h2 id="sol-dados">{{ t('ligacoes.solicitante.dados') }}</h2>
        <form class="barra" @submit.prevent="gravarDados">
          <div v-for="c in CAMPOS" :key="c" class="campo">
            <label :for="`sol-${c}`">{{
              t(
                `ligacoes.solicitante.${c === 'instituicaoNome' ? 'instituicao' : c === 'instituicaoCnes' ? 'cnes' : c}`,
              )
            }}</label>
            <input :id="`sol-${c}`" v-model="dados[c]" :disabled="!editar" :data-testid="`sol-${c}`" />
          </div>
          <SanteBotao
            v-if="editar"
            :rotulo="t('ligacoes.comum.gravar')"
            tipo="submit"
            data-testid="sol-gravar"
          />
        </form>
      </section>

      <section v-if="editar && !f.unificadoEm" aria-labelledby="sol-situacao">
        <h2 id="sol-situacao">
          {{ f.ativo ? t('ligacoes.solicitante.inativar') : t('ligacoes.solicitante.reativar') }}
        </h2>
        <div class="campo">
          <label for="sol-motivo">{{ t('ligacoes.solicitante.motivo') }}</label>
          <input id="sol-motivo" v-model="motivo" maxlength="200" data-testid="sol-motivo" />
        </div>
        <SanteBotao
          :rotulo="f.ativo ? t('ligacoes.solicitante.inativar') : t('ligacoes.solicitante.reativar')"
          :variante="f.ativo ? 'destrutivo' : 'secundario'"
          :confirmacao="f.ativo ? t('ligacoes.solicitante.inativar') : ''"
          :desabilitado="motivo.trim().length < 10"
          data-testid="sol-situacao"
          @acionar="
            fazer(() => mudarSituacaoSolicitante(Number(id), { versao: f!.versao, ativo: !f!.ativo, motivo }))
          "
        />
      </section>

      <section aria-labelledby="sol-parecidos">
        <h2 id="sol-parecidos">{{ t('ligacoes.solicitante.parecidos') }}</h2>
        <p v-if="f.parecidos.length === 0">{{ t('ligacoes.solicitante.semParecidos') }}</p>
        <ul v-else data-testid="sol-lista-parecidos">
          <li v-for="p in f.parecidos" :key="p.id">
            <RouterLink :to="`/cadastros/solicitantes/${p.id}`">{{ p.nome }}</RouterLink>
            — {{ p.registro }} ({{ t(`ligacoes.solicitante.motivos.${p.motivo}`) }})
            <SanteBotao
              v-if="podeUnificar && duplicado?.id !== p.id"
              :rotulo="t('ligacoes.solicitante.unificar')"
              variante="secundario"
              :data-testid="`sol-unificar-${p.id}`"
              @acionar="escolherDuplicado(p)"
            />
            <div
              v-if="podeUnificar && duplicado?.id === p.id"
              class="barra"
              data-testid="sol-unificar-painel"
            >
              <p class="aviso">
                <strong>{{ t('ligacoes.solicitante.unificarTitulo', { nome: p.nome }) }}.</strong>
                {{ t('ligacoes.solicitante.unificarAjuda') }}
              </p>
              <p v-if="p.traz?.length" data-testid="sol-unificar-traz">
                {{ t('ligacoes.solicitante.unificarTraz') }} {{ camposDaUnificacao(p.traz) }}.
              </p>
              <p v-if="p.difere?.length" data-testid="sol-unificar-difere">
                {{ t('ligacoes.solicitante.unificarDifere') }} {{ camposDaUnificacao(p.difere) }}.
              </p>
              <p data-testid="sol-unificar-registro">{{ t('ligacoes.solicitante.unificarRegistro') }}</p>
              <div class="campo">
                <label for="sol-motivo-unificar">{{ t('ligacoes.solicitante.unificarMotivo') }}</label>
                <input
                  id="sol-motivo-unificar"
                  v-model="motivoUnificar"
                  maxlength="200"
                  data-testid="sol-motivo-unificar"
                />
              </div>
              <SanteBotao
                :rotulo="t('ligacoes.solicitante.unificarConfirmar')"
                variante="destrutivo"
                :confirmacao="t('ligacoes.solicitante.unificarPergunta')"
                :desabilitado="motivoUnificar.trim().length < 10"
                data-testid="sol-unificar-confirmar"
                @acionar="unificar"
              />
              <SanteBotao
                :rotulo="t('ligacoes.solicitante.cancelar')"
                variante="texto"
                data-testid="sol-unificar-cancelar"
                @acionar="escolherDuplicado(null)"
              />
            </div>
          </li>
        </ul>
      </section>

      <section v-if="f.absorvidos?.length" aria-labelledby="sol-unificados">
        <h2 id="sol-unificados">{{ t('ligacoes.solicitante.unificados') }}</h2>
        <ul data-testid="sol-lista-unificados">
          <li v-for="a in f.absorvidos" :key="a.id">
            <RouterLink :to="`/cadastros/solicitantes/${a.id}`">{{ a.nome }}</RouterLink>
            — {{ a.registro }}
            <template v-if="a.quando">{{
              t('ligacoes.solicitante.unificadoDesde', { data: a.quando })
            }}</template>
            ({{ t('ligacoes.solicitante.atendimentosLigados', a.atendimentos) }})
          </li>
        </ul>
      </section>

      <section aria-labelledby="sol-codigos">
        <h2 id="sol-codigos">{{ t('ligacoes.solicitante.codigos') }}</h2>
        <p v-if="f.codigos.length === 0">{{ t('ligacoes.comum.nenhum') }}</p>
        <ul v-else data-testid="sol-lista-codigos">
          <li v-for="c in f.codigos" :key="c.id">
            {{ c.fonteNome }}: {{ c.codigo }}
            <span v-if="!c.ativo" class="pilula pilula--neutra">{{ t('ligacoes.comum.encerrada') }}</span>
            <SanteBotao
              v-if="editar && c.ativo"
              :rotulo="t('ligacoes.solicitante.inativarCodigo')"
              variante="secundario"
              @acionar="
                fazer(() =>
                  gravarCodigoNaFonte(Number(id), { fonte: c.fonte, codigo: c.codigo, ativo: false }),
                )
              "
            />
          </li>
        </ul>
        <form
          v-if="editar"
          class="barra"
          @submit.prevent="
            fazer(() => gravarCodigoNaFonte(Number(id), { fonte: fonte!, codigo, ativo: true }))
          "
        >
          <SanteSelecao
            id="sol-fonte"
            v-model="fonte"
            :rotulo="t('ligacoes.solicitante.fonte')"
            :opcoes="[
              { valor: null, rotulo: t('ligacoes.comum.escolha') },
              ...(fontes.data.value?.fontes ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
            ]"
            data-testid="sol-fonte"
          />
          <div class="campo">
            <label for="sol-codigo">{{ t('ligacoes.solicitante.codigo') }}</label>
            <input
              id="sol-codigo"
              v-model="codigo"
              maxlength="20"
              pattern="[0-9A-Za-z./\-]+"
              data-testid="sol-codigo"
            />
          </div>
          <SanteBotao
            :rotulo="t('ligacoes.comum.gravar')"
            tipo="submit"
            :desabilitado="fonte === null || !codigo.trim()"
            data-testid="sol-gravar-codigo"
          />
        </form>
      </section>
    </template>
  </div>
</template>
