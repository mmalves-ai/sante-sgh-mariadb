<script setup lang="ts">
// W1-01 (parte 9c2b): "Recertificação de acessos" (/administracao/acesso/recertificacao). Lista das campanhas com o
// relatório (mantidas, bloqueadas, revogadas, pendentes, atrasadas, %), abrir campanha (um grupo, um setor ou todas
// as contas; prazo; motivo; senha em diálogo), detalhe com as contas do retrato (manter; retirar com bloqueio da
// conta ou revogação de um perfil do retrato, com motivo) e encerrar/cancelar. A decisão é definitiva; o efeito da
// retirada é aplicado na hora (bloqueio pelo executor ou revogação do perfil) e fica na auditoria.
import type { CampanhaRecertTela, ItemRecertTela } from '@sgh/contratos';
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import {
  abrirRecertificacao,
  buscarRecertificacao,
  buscarRecertificacoes,
  decidirRecertificacao,
  fecharRecertificacao,
} from '../api-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['acesso', 'recertificacoes'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarRecertificacoes() });
const dados = computed(() => consulta.data.value ?? null);

const selecionada = ref<string | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => [...CHAVE, selecionada.value ?? '']),
  queryFn: () => buscarRecertificacao(selecionada.value ?? ''),
  enabled: computed(() => selecionada.value !== null),
});
const campanha = computed(() => (selecionada.value ? (detalhe.data.value ?? null) : null));
const aberta = computed(() => campanha.value?.campanha.situacao === 'aberta');

type Acao = 'abrir' | 'decidir' | 'fechar';
const dialogo = ref(false);
const acao = ref<Acao>('abrir');
const escopo = ref<'grupo' | 'setor' | 'todos' | null>('todos');
const alvo = ref<string | null>(null);
const prazo = ref('');
const item = ref<ItemRecertTela | null>(null);
const decisao = ref<'manter' | 'retirar' | null>('manter');
const efeito = ref<'bloqueio' | 'revogacao' | null>(null);
const perfil = ref<string | null>(null);
const situacaoFechar = ref<'encerrada' | 'cancelada' | null>('encerrada');
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const aviso = ref('');
const recusa = ref('');
const ocupado = ref(false);

watch(dialogo, (v) => {
  if (!v) {
    senha.value = '';
    erroSenha.value = '';
  }
});

// Os alvos vêm com a lista das campanhas, já com a contagem das contas de cada um: só aparece escopo que tem o que
// recertificar, e quem abre vê o tamanho da campanha antes de confirmar.
const alvos = computed(() => dados.value?.alvos ?? null);
const opcoesAlvo = computed(() => {
  const a = alvos.value;
  if (!a) return [];
  return (escopo.value === 'grupo' ? a.grupos : a.setores).map((x) => ({
    valor: x.valor,
    rotulo: `${x.valor} (${x.contas})`,
  }));
});
watch(escopo, () => {
  alvo.value = null;
});
watch(decisao, (d) => {
  if (d === 'retirar' && efeito.value === null) efeito.value = 'bloqueio';
  if (d !== 'retirar') efeito.value = null;
});
watch(efeito, (e) => {
  if (e !== 'revogacao') perfil.value = null;
});

const opcoesEscopo = computed(() =>
  (['todos', 'grupo', 'setor'] as const).map((v) => ({
    valor: v,
    rotulo: t(`acesso.recertificacao.escopos.${v}`),
  })),
);
const opcoesDecisao = computed(() =>
  (['manter', 'retirar'] as const).map((v) => ({
    valor: v,
    rotulo: t(`acesso.recertificacao.decisoes.${v}`),
  })),
);
const opcoesEfeito = computed(() =>
  (['bloqueio', 'revogacao'] as const)
    .filter((v) => v !== 'revogacao' || (item.value?.perfis.length ?? 0) > 0)
    .map((v) => ({ valor: v, rotulo: t(`acesso.recertificacao.efeitos.${v}`) })),
);
const opcoesPerfil = computed(() => (item.value?.perfis ?? []).map((p) => ({ valor: p, rotulo: p })));
const opcoesFechar = computed(() =>
  (['encerrada', 'cancelada'] as const).map((v) => ({
    valor: v,
    rotulo: t(`acesso.recertificacao.fechar.${v}`),
  })),
);

const data = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const escopoDe = (c: CampanhaRecertTela) =>
  c.escopo === 'todos'
    ? t('acesso.recertificacao.escopos.todos')
    : `${t(`acesso.recertificacao.escopos.${c.escopo}`)}: ${c.alvo ?? ''}`;
const situacaoDe = (c: CampanhaRecertTela) => t(`acesso.recertificacao.situacoes.${c.situacao}`);
const relatorioDe = (c: CampanhaRecertTela) => t('acesso.recertificacao.relatorio', { ...c.relatorio });
const decisaoDe = (i: ItemRecertTela) => {
  if (i.decisao === null) return t('acesso.recertificacao.pendente');
  if (i.decisao === 'manter') return t('acesso.recertificacao.decisoes.manter');
  return i.acao === 'revogacao'
    ? t('acesso.recertificacao.retiradaRevogacao', { perfil: i.perfil ?? '' })
    : t('acesso.recertificacao.retiradaBloqueio');
};

const prazoValido = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(prazo.value));
const motivoOk = computed(() => motivo.value.trim().length >= 10);
const pronto = computed(() => {
  if (ocupado.value || senha.value.length === 0) return false;
  if (acao.value === 'abrir')
    return (
      !!escopo.value && (escopo.value === 'todos' || !!alvo.value) && prazoValido.value && motivoOk.value
    );
  if (acao.value === 'fechar') return !!situacaoFechar.value && motivoOk.value;
  if (!item.value || !decisao.value) return false;
  if (decisao.value === 'manter') return true;
  if (!efeito.value || !motivoOk.value) return false;
  return efeito.value === 'bloqueio' || !!perfil.value;
});

const titulo = computed(() =>
  acao.value === 'abrir'
    ? t('acesso.recertificacao.dialogoAbrir')
    : acao.value === 'fechar'
      ? t('acesso.recertificacao.dialogoFechar')
      : t('acesso.recertificacao.dialogoDecidir', { login: item.value?.login ?? '' }),
);

function limpar() {
  motivo.value = '';
  aviso.value = '';
  recusa.value = '';
}
function abrirNova() {
  acao.value = 'abrir';
  escopo.value = 'todos';
  alvo.value = null;
  prazo.value = dados.value?.prazoPadrao ?? '';
  limpar();
  dialogo.value = true;
}
function abrirDecisao(i: ItemRecertTela, d: 'manter' | 'retirar') {
  acao.value = 'decidir';
  item.value = i;
  decisao.value = d;
  efeito.value = d === 'retirar' ? 'bloqueio' : null;
  perfil.value = null;
  limpar();
  dialogo.value = true;
}
function abrirFechar(s: 'encerrada' | 'cancelada') {
  acao.value = 'fechar';
  situacaoFechar.value = s;
  limpar();
  dialogo.value = true;
}
function ver(id: string) {
  selecionada.value = id;
  aviso.value = '';
  recusa.value = '';
}

async function confirmar(): Promise<void> {
  if (!pronto.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    if (acao.value === 'abrir') {
      const r = await abrirRecertificacao({
        escopo: escopo.value ?? 'todos',
        alvo: escopo.value === 'todos' ? null : alvo.value,
        prazo: prazo.value,
        motivo: motivo.value.trim(),
        senha: senha.value,
      });
      aviso.value = t('acesso.recertificacao.aberta', { n: r.itens });
      selecionada.value = r.id;
    } else if (acao.value === 'fechar') {
      const id = selecionada.value ?? '';
      const r = await fecharRecertificacao(id, {
        situacao: situacaoFechar.value ?? 'encerrada',
        motivo: motivo.value.trim(),
        senha: senha.value,
      });
      aviso.value = t(`acesso.recertificacao.fechadaAviso.${r.situacao}`, { n: r.pendentes });
    } else {
      const id = selecionada.value ?? '';
      const l = item.value?.login ?? '';
      const retirar = decisao.value === 'retirar';
      await decidirRecertificacao(id, {
        login: l,
        decisao: retirar ? 'retirar' : 'manter',
        acao: retirar ? efeito.value : null,
        perfil: retirar && efeito.value === 'revogacao' ? perfil.value : null,
        motivo: motivo.value.trim(),
        senha: senha.value,
      });
      aviso.value = retirar
        ? t('acesso.recertificacao.retiradaAviso', { login: l })
        : t('acesso.recertificacao.mantidaAviso', { login: l });
    }
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    const p = e instanceof ErroApi ? e.problema : null;
    const tipoP = p ? tipoDoProblema(p) : null;
    if (e instanceof ErroApi && (tipoP === 'reautenticacao-necessaria' || e.status === 401)) {
      erroSenha.value = t('acesso.recertificacao.senhaErrada');
      senha.value = '';
      return;
    }
    dialogo.value = false;
    const codigo = (p as { codigo?: unknown } | null)?.codigo;
    const detalheP = p?.detail || p?.title || '';
    recusa.value =
      codigo === 'efeito-pendente'
        ? t('acesso.recertificacao.efeitoPendente', { detalhe: detalheP })
        : codigo === 'operacao-desligada'
          ? t('acesso.recertificacao.operacaoDesligada', { motivo: detalheP })
          : detalheP || t('acesso.recertificacao.falha');
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="recert-titulo">
    <h1 id="recert-titulo">{{ t('acesso.recertificacao.titulo') }}</h1>
    <p>{{ t('acesso.recertificacao.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="recert-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recert-recusa" />

    <template v-if="dados">
      <SanteAlerta
        v-if="!dados.bloqueio.ligada"
        :texto="t('acesso.recertificacao.bloqueioDesligado', { motivo: dados.bloqueio.motivo ?? '' })"
        variante="aviso"
        data-testid="recert-bloqueio-desligado"
      />
      <div class="recert__acoes">
        <SanteBotao
          :rotulo="t('acesso.recertificacao.abrir')"
          data-testid="recert-abrir"
          @acionar="abrirNova"
        />
      </div>

      <section aria-labelledby="recert-campanhas">
        <h2 id="recert-campanhas">
          {{ t('acesso.recertificacao.campanhas', { n: dados.campanhas.length }) }}
        </h2>
        <p v-if="!dados.campanhas.length" data-testid="recert-nenhuma">
          {{ t('acesso.recertificacao.nenhuma') }}
        </p>
        <div v-else class="recert__rolagem">
          <table data-testid="recert-campanhas">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.recertificacao.colEscopo') }}</th>
                <th scope="col">{{ t('acesso.recertificacao.colPrazo') }}</th>
                <th scope="col">{{ t('acesso.recertificacao.colSituacao') }}</th>
                <th scope="col">{{ t('acesso.recertificacao.colRelatorio') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.recertificacao.ver') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in dados.campanhas" :key="c.id" :data-testid="`recert-campanha-${c.id}`">
                <td>{{ escopoDe(c) }}</td>
                <td>{{ data(c.prazo) }}</td>
                <td>{{ situacaoDe(c) }}</td>
                <td>{{ relatorioDe(c) }}</td>
                <td>
                  <SanteBotao
                    :rotulo="t('acesso.recertificacao.ver')"
                    variante="texto"
                    :data-testid="`recert-ver-${c.id}`"
                    @acionar="ver(c.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <MensagemErro v-if="selecionada && detalhe.isError.value" :erro="detalhe.error.value" />
    <section
      v-if="campanha"
      class="recert__cartao"
      aria-labelledby="recert-detalhe"
      data-testid="recert-detalhe"
    >
      <h2 id="recert-detalhe">
        {{ t('acesso.recertificacao.detalhe', { escopo: escopoDe(campanha.campanha) }) }}
      </h2>
      <ul data-testid="recert-resumo">
        <li>{{ t('acesso.recertificacao.situacao') }}: {{ situacaoDe(campanha.campanha) }}</li>
        <li>{{ t('acesso.recertificacao.colPrazo') }}: {{ data(campanha.campanha.prazo) }}</li>
        <li>
          {{
            t('acesso.recertificacao.abertaPor', {
              por: campanha.campanha.criadoPor,
              em: quando(campanha.campanha.criadoEm),
            })
          }}
          · {{ campanha.campanha.motivo }}
        </li>
        <li v-if="campanha.campanha.fechadoPor">
          {{
            t('acesso.recertificacao.fechadaPor', {
              por: campanha.campanha.fechadoPor,
              em: quando(campanha.campanha.fechadoEm),
            })
          }}
          · {{ campanha.campanha.motivoFechamento }}
        </li>
        <li>{{ relatorioDe(campanha.campanha) }}</li>
      </ul>
      <div v-if="aberta" class="recert__acoes">
        <SanteBotao
          :rotulo="t('acesso.recertificacao.encerrar')"
          variante="secundario"
          data-testid="recert-encerrar"
          @acionar="abrirFechar('encerrada')"
        />
        <SanteBotao
          :rotulo="t('acesso.recertificacao.cancelar')"
          variante="texto"
          data-testid="recert-cancelar"
          @acionar="abrirFechar('cancelada')"
        />
      </div>
      <div class="recert__rolagem">
        <table data-testid="recert-itens">
          <thead>
            <tr>
              <th scope="col">{{ t('acesso.recertificacao.colLogin') }}</th>
              <th scope="col">{{ t('acesso.recertificacao.colGrupo') }}</th>
              <th scope="col">{{ t('acesso.recertificacao.colPerfis') }}</th>
              <th scope="col">{{ t('acesso.recertificacao.colDecisao') }}</th>
              <th scope="col">
                <span class="oculto">{{ t('acesso.recertificacao.colAcoes') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in campanha.itens" :key="i.login" :data-testid="`recert-item-${i.login}`">
              <td>{{ i.login }}</td>
              <td>{{ i.grupo ?? '—' }}</td>
              <td>{{ i.perfis.length ? i.perfis.join(', ') : '—' }}</td>
              <td>
                {{ decisaoDe(i) }}
                <template v-if="i.decididoPor">
                  · {{ i.decididoPor }} · {{ quando(i.decididoEm) }}
                  <template v-if="i.motivo">· {{ i.motivo }}</template>
                </template>
              </td>
              <td class="recert__linha-acoes">
                <template v-if="aberta && i.decisao === null">
                  <SanteBotao
                    :rotulo="t('acesso.recertificacao.decisoes.manter')"
                    variante="texto"
                    :data-testid="`recert-manter-${i.login}`"
                    @acionar="abrirDecisao(i, 'manter')"
                  />
                  <SanteBotao
                    :rotulo="t('acesso.recertificacao.decisoes.retirar')"
                    variante="texto"
                    :data-testid="`recert-retirar-${i.login}`"
                    @acionar="abrirDecisao(i, 'retirar')"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <SanteDialogo v-model:visivel="dialogo" :titulo="titulo">
      <form class="recert__form" data-testid="recert-form" @submit.prevent="confirmar">
        <template v-if="acao === 'abrir'">
          <SanteSelecao
            v-model="escopo"
            :rotulo="t('acesso.recertificacao.campoEscopo')"
            :opcoes="opcoesEscopo"
            obrigatorio
            data-testid="recert-escopo"
          />
          <SanteSelecao
            v-if="escopo !== 'todos'"
            v-model="alvo"
            :rotulo="
              escopo === 'grupo'
                ? t('acesso.recertificacao.campoGrupo')
                : t('acesso.recertificacao.campoSetor')
            "
            :opcoes="opcoesAlvo"
            busca
            obrigatorio
            data-testid="recert-alvo"
          />
          <div class="campo">
            <label for="recert-prazo">{{
              t('acesso.recertificacao.campoPrazo', { n: dados?.prazoMaximoDias ?? 90 })
            }}</label>
            <input id="recert-prazo" v-model="prazo" type="date" data-testid="recert-prazo" />
          </div>
        </template>
        <template v-else-if="acao === 'decidir'">
          <p v-if="item">
            {{ t('acesso.recertificacao.textoDecidir', { perfis: item.perfis.join(', ') || '—' }) }}
          </p>
          <SanteSelecao
            v-model="decisao"
            :rotulo="t('acesso.recertificacao.campoDecisao')"
            :opcoes="opcoesDecisao"
            obrigatorio
            data-testid="recert-decisao"
          />
          <template v-if="decisao === 'retirar'">
            <SanteSelecao
              v-model="efeito"
              :rotulo="t('acesso.recertificacao.campoEfeito')"
              :opcoes="opcoesEfeito"
              obrigatorio
              data-testid="recert-efeito"
            />
            <SanteSelecao
              v-if="efeito === 'revogacao'"
              v-model="perfil"
              :rotulo="t('acesso.recertificacao.campoPerfil')"
              :opcoes="opcoesPerfil"
              busca
              obrigatorio
              data-testid="recert-perfil"
            />
            <SanteAlerta
              v-if="efeito === 'bloqueio' && dados && !dados.bloqueio.ligada"
              :texto="t('acesso.recertificacao.bloqueioDesligado', { motivo: dados.bloqueio.motivo ?? '' })"
              variante="aviso"
            />
          </template>
          <p>{{ t('acesso.recertificacao.definitiva') }}</p>
        </template>
        <template v-else>
          <SanteSelecao
            v-model="situacaoFechar"
            :rotulo="t('acesso.recertificacao.campoFechar')"
            :opcoes="opcoesFechar"
            obrigatorio
            data-testid="recert-situacao"
          />
          <p>
            {{ t('acesso.recertificacao.textoFechar', { n: campanha?.campanha.relatorio.pendentes ?? 0 }) }}
          </p>
        </template>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="
            acao === 'decidir' && decisao === 'manter'
              ? t('acesso.recertificacao.campoMotivoOpcional')
              : t('acesso.recertificacao.campoMotivo')
          "
          :max-bytes="200"
          data-testid="recert-motivo"
        />
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="recert-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="recert-senha" />
        <div class="recert__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('acesso.recertificacao.gravando') : t('acesso.recertificacao.gravar')"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="recert-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.recert__cartao {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 8px);
  padding: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
.recert__acoes,
.recert__linha-acoes,
.recert__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.recert__botoes {
  justify-content: flex-end;
}
.recert__rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: var(--sgh-espaco-2);
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.recert__form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
input {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  max-width: 12rem;
}
</style>
