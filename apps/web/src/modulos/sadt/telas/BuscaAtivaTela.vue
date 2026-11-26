<script setup lang="ts">
// Busca ativa de resultados (F8, 05-SADT linha 24): `/sadt/busca-ativa`. A fila traz os casos abertos dos resultados
// críticos, alterados ou de cultura positiva que saíram depois da alta, o atrasado primeiro e em destaque. "Procurar
// novos resultados" mostra antes os candidatos e só então abre os casos (um por requisição). O caso traz os exames, a
// equipe da regra e o histórico das tentativas; o contato, a conclusão e o cancelamento são conferidos na hora pela
// mesma regra do domínio que o servidor aplica. Nada é apagado: o cancelamento pede o motivo e guarda o histórico.
import {
  conferirCancelamentoBuscaAtiva,
  conferirConclusaoBuscaAtiva,
  conferirContatoBuscaAtiva,
  type DesfechoBuscaAtiva,
  type ResultadoContato,
} from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirCasosBuscaAtiva,
  type ApoioBuscaAtiva,
  type CandidatoBuscaAtiva,
  cancelarBuscaAtiva,
  type CasoNaFila,
  concluirBuscaAtiva,
  type DetalheBuscaAtiva,
  lerApoioBuscaAtiva,
  lerCandidatosBuscaAtiva,
  lerCasoBuscaAtiva,
  lerFilaBuscaAtiva,
  registrarContatoBuscaAtiva,
} from '../api-busca-ativa.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t } = useI18n();
const apoio = ref<ApoioBuscaAtiva | null>(null);
const fila = ref<CasoNaFila[]>([]);
const todos = ref(false);
const paciente = ref('');
const candidatos = ref<CandidatoBuscaAtiva[] | null>(null);
const caso = ref<DetalheBuscaAtiva | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const carregando = ref(false);

const agoraLocal = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const contato = ref({
  contatadoEm: agoraLocal(),
  canal: '',
  resultado: '',
  orientacao: '',
  novaColetaEm: '',
});
const conclusao = ref({ desfecho: '', observacao: '' });
const motivoCancelamento = ref('');
const cancelando = ref(false);

const quando = (v: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const rotulo = (grupo: 'motivos' | 'situacoes' | 'resultados' | 'desfechos', v: string | null) =>
  v ? t(`sadt.buscaAtiva.${grupo}.${v}`) : '';

const canais = computed(() => [
  { valor: '', rotulo: t('sadt.buscaAtiva.canalNaoInformado') },
  ...(apoio.value?.canais ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome })),
]);
const resultados = computed(() => [
  { valor: '', rotulo: t('sadt.buscaAtiva.escolha') },
  ...(apoio.value?.resultadosContato ?? []).map((r) => ({ valor: r, rotulo: rotulo('resultados', r) })),
]);
const desfechos = computed(() => [
  { valor: '', rotulo: t('sadt.buscaAtiva.escolha') },
  ...(apoio.value?.desfechos ?? []).map((d) => ({ valor: d, rotulo: rotulo('desfechos', d) })),
]);

const dataOuNula = (v: string) => (v ? new Date(v) : null);
// Conferência na hora, pela regra do domínio (a mesma do servidor).
const problemasContato = computed(() => {
  if (!caso.value || !contato.value.resultado) return [];
  return conferirContatoBuscaAtiva(
    caso.value.situacao,
    {
      resultado: contato.value.resultado as ResultadoContato,
      orientacao: contato.value.orientacao.trim() || null,
      contatadoEm: dataOuNula(contato.value.contatadoEm) ?? new Date(),
      novaColetaEm: dataOuNula(contato.value.novaColetaEm),
    },
    new Date(),
  );
});
const problemasConclusao = computed(() =>
  caso.value && conclusao.value.desfecho
    ? conferirConclusaoBuscaAtiva(
        caso.value.situacao,
        conclusao.value.desfecho as DesfechoBuscaAtiva,
        caso.value.contatos.map((c) => ({ resultado: c.resultado as ResultadoContato })),
      )
    : [],
);
const problemasCancelamento = computed(() =>
  caso.value && motivoCancelamento.value
    ? conferirCancelamentoBuscaAtiva(caso.value.situacao, motivoCancelamento.value)
    : [],
);
const encerrado = computed(
  () => caso.value?.situacao === 'concluido' || caso.value?.situacao === 'cancelado',
);
const podeContato = computed(
  () => !!contato.value.resultado && problemasContato.value.length === 0 && !carregando.value,
);
const podeConcluir = computed(
  () => !!conclusao.value.desfecho && problemasConclusao.value.length === 0 && !carregando.value,
);
const podeCancelar = computed(
  () =>
    motivoCancelamento.value.trim().length >= 5 &&
    problemasCancelamento.value.length === 0 &&
    !carregando.value,
);

async function executar(fn: () => Promise<void>): Promise<void> {
  carregando.value = true;
  erro.value = null;
  try {
    await fn();
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
}
const codigoPaciente = () => {
  const n = Number(paciente.value.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};
const carregarFila = () =>
  executar(async () => {
    fila.value = (await lerFilaBuscaAtiva(todos.value, codigoPaciente())).itens;
  });
const procurarNovos = () =>
  executar(async () => {
    mensagem.value = null;
    candidatos.value = (await lerCandidatosBuscaAtiva()).itens;
  });
const abrirCasos = () =>
  executar(async () => {
    const r = await abrirCasosBuscaAtiva(novaChave('busca-ativa.abrir'));
    mensagem.value = t('sadt.buscaAtiva.abertos', r);
    candidatos.value = null;
    fila.value = (await lerFilaBuscaAtiva(todos.value, codigoPaciente())).itens;
  });
const limparFormularios = () => {
  contato.value = { contatadoEm: agoraLocal(), canal: '', resultado: '', orientacao: '', novaColetaEm: '' };
  conclusao.value = { desfecho: '', observacao: '' };
  motivoCancelamento.value = '';
  cancelando.value = false;
};
const abrirCaso = (id: number) =>
  executar(async () => {
    mensagem.value = null;
    limparFormularios();
    caso.value = await lerCasoBuscaAtiva(id);
  });
async function recarregarCaso(texto: string): Promise<void> {
  if (!caso.value) return;
  const id = caso.value.id;
  limparFormularios();
  caso.value = await lerCasoBuscaAtiva(id);
  fila.value = (await lerFilaBuscaAtiva(todos.value, codigoPaciente())).itens;
  mensagem.value = texto;
}
const registrarContato = () =>
  executar(async () => {
    if (!caso.value || !podeContato.value) return;
    const c = contato.value;
    await registrarContatoBuscaAtiva(
      caso.value.id,
      {
        versao: caso.value.versao,
        contatadoEm: new Date(c.contatadoEm).toISOString(),
        canal: c.canal ? Number(c.canal) : null,
        resultado: c.resultado as ResultadoContato,
        orientacao: c.orientacao.trim() || null,
        novaColetaEm: c.novaColetaEm ? new Date(c.novaColetaEm).toISOString() : null,
      },
      novaChave('busca-ativa.contato'),
    );
    await recarregarCaso(t('sadt.buscaAtiva.contatoRegistrado'));
  });
const concluir = () =>
  executar(async () => {
    if (!caso.value || !podeConcluir.value) return;
    await concluirBuscaAtiva(
      caso.value.id,
      {
        versao: caso.value.versao,
        desfecho: conclusao.value.desfecho,
        observacao: conclusao.value.observacao.trim() || null,
      },
      novaChave('busca-ativa.concluir'),
    );
    await recarregarCaso(t('sadt.buscaAtiva.concluido'));
  });
const cancelar = () =>
  executar(async () => {
    if (!caso.value || !podeCancelar.value) return;
    await cancelarBuscaAtiva(
      caso.value.id,
      { versao: caso.value.versao, observacao: motivoCancelamento.value.trim() },
      novaChave('busca-ativa.cancelar'),
    );
    await recarregarCaso(t('sadt.buscaAtiva.cancelado'));
  });

onMounted(() =>
  executar(async () => {
    const [a, f] = await Promise.all([lerApoioBuscaAtiva(), lerFilaBuscaAtiva(false, null)]);
    apoio.value = a;
    fila.value = f.itens;
  }),
);
</script>

<template>
  <section class="busca-ativa" data-testid="busca-ativa">
    <h1>{{ t('sadt.buscaAtiva.titulo') }}</h1>
    <p>{{ t('sadt.buscaAtiva.explicacao') }}</p>
    <p v-if="mensagem" role="status" data-testid="busca-ativa-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />

    <template v-if="!caso">
      <form class="linha" @submit.prevent="carregarFila">
        <label
          >{{ t('sadt.buscaAtiva.filtroPaciente')
          }}<input v-model="paciente" inputmode="numeric" maxlength="12" data-testid="busca-ativa-paciente"
        /></label>
        <label class="marca"
          ><input v-model="todos" type="checkbox" data-testid="busca-ativa-todos" />{{
            t('sadt.buscaAtiva.verEncerrados')
          }}</label
        >
        <SanteBotao
          :rotulo="t('sadt.buscaAtiva.atualizar')"
          :desabilitado="carregando"
          data-testid="busca-ativa-atualizar"
          @acionar="carregarFila"
        />
        <SanteBotao
          :rotulo="t('sadt.buscaAtiva.procurarNovos')"
          :desabilitado="carregando"
          data-testid="busca-ativa-procurar"
          @acionar="procurarNovos"
        />
      </form>

      <fieldset v-if="candidatos" data-testid="busca-ativa-candidatos">
        <legend>{{ t('sadt.buscaAtiva.candidatos') }}</legend>
        <p v-if="candidatos.length === 0">{{ t('sadt.buscaAtiva.nenhumCandidato') }}</p>
        <ul v-else>
          <li v-for="k in candidatos" :key="k.requisicao">
            {{ rotulo('motivos', k.motivo) }} ·
            {{
              t('sadt.buscaAtiva.candidato', {
                requisicao: k.requisicao,
                paciente: k.paciente,
                exames: k.exames,
                prazo: quando(k.prazoEm),
              })
            }}
          </li>
        </ul>
        <SanteBotao
          v-if="candidatos.length > 0"
          :rotulo="t('sadt.buscaAtiva.abrirCasos', { quantos: candidatos.length })"
          :desabilitado="carregando"
          data-testid="busca-ativa-abrir-casos"
          @acionar="abrirCasos"
        />
      </fieldset>

      <p v-if="fila.length === 0" data-testid="busca-ativa-fila-vazia">
        {{ t('sadt.buscaAtiva.filaVazia') }}
      </p>
      <table v-else data-testid="busca-ativa-fila">
        <thead>
          <tr>
            <th>{{ t('sadt.buscaAtiva.colunas.numero') }}</th>
            <th>{{ t('sadt.buscaAtiva.colunas.paciente') }}</th>
            <th>{{ t('sadt.buscaAtiva.colunas.motivo') }}</th>
            <th>{{ t('sadt.buscaAtiva.colunas.exames') }}</th>
            <th>{{ t('sadt.buscaAtiva.colunas.prazo') }}</th>
            <th>{{ t('sadt.buscaAtiva.colunas.situacao') }}</th>
            <th>{{ t('sadt.buscaAtiva.colunas.tentativas') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in fila"
            :key="c.id"
            :class="{ atrasado: c.atrasado }"
            :data-testid="`busca-ativa-caso-${c.numero}`"
          >
            <td>{{ c.numero }}</td>
            <td>
              {{ c.pacienteNome }}<br /><small>{{
                t('sadt.buscaAtiva.prontuario', { numero: c.prontuario })
              }}</small>
            </td>
            <td>{{ rotulo('motivos', c.motivo) }}</td>
            <td>{{ c.exames }}</td>
            <td>
              <strong v-if="c.atrasado" class="selo-atraso" data-testid="busca-ativa-atrasado">{{
                t('sadt.buscaAtiva.atrasado')
              }}</strong>
              {{ c.prazoEm ? quando(c.prazoEm) : t('sadt.buscaAtiva.semPrazo') }}
            </td>
            <td>{{ rotulo('situacoes', c.situacao) }}</td>
            <td>{{ c.tentativas }}</td>
            <td>
              <SanteBotao
                :rotulo="t('sadt.buscaAtiva.abrir')"
                :data-testid="`busca-ativa-abrir-${c.numero}`"
                @acionar="abrirCaso(c.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <SanteBotao
        :rotulo="t('sadt.buscaAtiva.voltar')"
        data-testid="busca-ativa-voltar"
        @acionar="caso = null"
      />
      <h2 data-testid="busca-ativa-caso">{{ caso.numero }} · {{ rotulo('situacoes', caso.situacao) }}</h2>
      <p v-if="encerrado" data-testid="busca-ativa-encerrado">
        {{
          t('sadt.buscaAtiva.encerrado', {
            quando: quando(caso.concluidoEm),
            por: caso.concluidoPor ?? '',
            desfecho: caso.desfecho ? rotulo('desfechos', caso.desfecho) : (caso.observacao ?? ''),
          })
        }}
      </p>

      <fieldset data-testid="busca-ativa-exames">
        <legend>{{ t('sadt.buscaAtiva.exames') }}</legend>
        <ul>
          <li v-for="x in caso.exames" :key="x.id">
            {{ x.nome }}
            <strong v-if="x.critico" class="selo-atraso">{{ t('sadt.buscaAtiva.critico') }}</strong>
            <em v-else-if="x.alterado">{{ t('sadt.buscaAtiva.alterado') }}</em>
            <small v-if="x.liberadoEm">
              · {{ t('sadt.buscaAtiva.liberadoEm', { quando: quando(x.liberadoEm) }) }}</small
            >
          </li>
        </ul>
      </fieldset>

      <fieldset data-testid="busca-ativa-equipe">
        <legend>{{ t('sadt.buscaAtiva.equipe') }}</legend>
        <p v-if="caso.equipe.length === 0">{{ t('sadt.buscaAtiva.semEquipe') }}</p>
        <p v-else>{{ caso.equipe.map((e) => e.nome).join(', ') }}</p>
      </fieldset>

      <fieldset data-testid="busca-ativa-historico">
        <legend>{{ t('sadt.buscaAtiva.historico') }}</legend>
        <p v-if="caso.contatos.length === 0">{{ t('sadt.buscaAtiva.semContato') }}</p>
        <ol v-else>
          <li v-for="k in caso.contatos" :key="k.id">
            {{
              t('sadt.buscaAtiva.contatoPor', {
                quando: quando(k.contatadoEm),
                resultado: rotulo('resultados', k.resultado),
                canal: k.canal ?? t('sadt.buscaAtiva.canalNaoInformado'),
                por: k.por ?? '',
              })
            }}
            <span v-if="k.orientacao"><br />{{ k.orientacao }}</span>
            <small v-if="k.novaColetaEm"
              ><br />{{ t('sadt.buscaAtiva.novaColeta', { quando: quando(k.novaColetaEm) }) }}</small
            >
          </li>
        </ol>
      </fieldset>

      <template v-if="!encerrado">
        <fieldset data-testid="busca-ativa-contato">
          <legend>{{ t('sadt.buscaAtiva.novoContato') }}</legend>
          <div class="linha">
            <label
              >{{ t('sadt.buscaAtiva.contatadoEm')
              }}<input
                v-model="contato.contatadoEm"
                type="datetime-local"
                data-testid="busca-ativa-contatado-em"
            /></label>
            <SanteSelecao
              v-model="contato.canal"
              :rotulo="t('sadt.buscaAtiva.canal')"
              :opcoes="canais"
              data-testid="busca-ativa-canal"
            />
            <SanteSelecao
              v-model="contato.resultado"
              :rotulo="t('sadt.buscaAtiva.resultado')"
              :opcoes="resultados"
              data-testid="busca-ativa-resultado"
            />
          </div>
          <label
            >{{ t('sadt.buscaAtiva.orientacao')
            }}<textarea
              v-model="contato.orientacao"
              maxlength="4000"
              rows="3"
              data-testid="busca-ativa-orientacao"
            />
          </label>
          <label
            >{{ t('sadt.buscaAtiva.novaColetaEm')
            }}<input
              v-model="contato.novaColetaEm"
              type="datetime-local"
              data-testid="busca-ativa-nova-coleta"
          /></label>
          <ul v-if="problemasContato.length" class="problemas" data-testid="busca-ativa-problemas-contato">
            <li v-for="p in problemasContato" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('sadt.buscaAtiva.registrarContato')"
            :desabilitado="!podeContato"
            data-testid="busca-ativa-registrar-contato"
            @acionar="registrarContato"
          />
        </fieldset>

        <fieldset data-testid="busca-ativa-conclusao">
          <legend>{{ t('sadt.buscaAtiva.concluir') }}</legend>
          <div class="linha">
            <SanteSelecao
              v-model="conclusao.desfecho"
              :rotulo="t('sadt.buscaAtiva.desfecho')"
              :opcoes="desfechos"
              data-testid="busca-ativa-desfecho"
            />
            <label
              >{{ t('sadt.buscaAtiva.observacao')
              }}<input v-model="conclusao.observacao" maxlength="1000" data-testid="busca-ativa-observacao"
            /></label>
          </div>
          <ul
            v-if="problemasConclusao.length"
            class="problemas"
            data-testid="busca-ativa-problemas-conclusao"
          >
            <li v-for="p in problemasConclusao" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('sadt.buscaAtiva.confirmarConclusao')"
            :desabilitado="!podeConcluir"
            data-testid="busca-ativa-concluir"
            @acionar="concluir"
          />
        </fieldset>

        <fieldset data-testid="busca-ativa-cancelamento">
          <legend>
            <label class="marca"
              ><input v-model="cancelando" type="checkbox" data-testid="busca-ativa-quer-cancelar" />{{
                t('sadt.buscaAtiva.cancelar')
              }}</label
            >
          </legend>
          <template v-if="cancelando">
            <label
              >{{ t('sadt.buscaAtiva.motivoCancelamento')
              }}<input
                v-model="motivoCancelamento"
                maxlength="1000"
                data-testid="busca-ativa-motivo-cancelamento"
            /></label>
            <ul v-if="problemasCancelamento.length" class="problemas">
              <li v-for="p in problemasCancelamento" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
            </ul>
            <SanteBotao
              :rotulo="t('sadt.buscaAtiva.confirmarCancelamento')"
              :desabilitado="!podeCancelar"
              data-testid="busca-ativa-cancelar"
              @acionar="cancelar"
            />
          </template>
        </fieldset>
      </template>
    </template>
  </section>
</template>

<style scoped>
.busca-ativa {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
label {
  display: grid;
  gap: var(--sgh-espaco-1);
}
label.marca {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  border-bottom: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  text-align: left;
  vertical-align: top;
}
tr.atrasado td:first-child {
  border-left: 4px solid var(--sgh-alerta);
}
.selo-atraso {
  color: var(--sgh-alerta-texto);
}
.problemas {
  color: var(--sgh-alerta-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
</style>
